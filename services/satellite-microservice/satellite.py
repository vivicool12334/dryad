"""
Satellite observation pipeline for Dryad.

Pulls Sentinel-2 L2A imagery from Microsoft Planetary Computer,
clips to the 9 Chadsey-Condon parcels, computes NDVI and EVI per
parcel, and renders RGB previews.

Designed to be called from main.py (FastAPI) or observe_local.py (CLI).
"""
from __future__ import annotations

import io
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import planetary_computer
import pystac_client
import rasterio
from PIL import Image
from rasterio.windows import from_bounds
from shapely.geometry import box

logger = logging.getLogger(__name__)

# Microsoft Planetary Computer STAC API
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
SENTINEL_COLLECTION = "sentinel-2-l2a"

# Bands we need (Sentinel-2 nomenclature)
#   B02 = blue, B03 = green, B04 = red, B08 = NIR
NEEDED_BANDS = ["B02", "B03", "B04", "B08"]

# Per-parcel half-extent in degrees (lots are ~30m × 30m, ~0.00027 deg lat).
# We pull a small bounding box per parcel and compute stats inside it.
PARCEL_HALF_DEG = 0.00018  # ~20 meters

# Default search window (days back from "now" or from a given timestamp)
DEFAULT_WINDOW_DAYS = 30

# Cloud cover threshold (Sentinel reports 0-100)
DEFAULT_CLOUD_COVER_MAX = 20.0


@dataclass
class ParcelObservation:
    """One satellite observation for one parcel."""

    parcel_address: str
    parcel_number: str
    lat: float
    lng: float
    ndvi_mean: float
    ndvi_std: float
    ndvi_min: float
    ndvi_max: float
    evi_mean: float
    cloud_cover: float
    capture_datetime: str  # ISO 8601 from the Sentinel scene
    scene_id: str
    satellite: str  # "sentinel-2a" or "sentinel-2b"
    bbox: list[float]  # [west, south, east, north] in deg
    pixel_count: int
    raster_local_path: str | None = None
    preview_local_path: str | None = None
    raster_ipfs_hash: str | None = None
    preview_ipfs_hash: str | None = None
    raster_ipfs_url: str | None = None
    preview_ipfs_url: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ObservationCycle:
    """Result of one full satellite observation cycle."""

    cycle_id: str
    cycle_at: str  # ISO 8601, when we ran the cycle
    aoi_bbox: list[float]  # combined AOI we searched
    scenes_searched: int
    scenes_used: int
    observations: list[ParcelObservation]
    errors: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "cycle_id": self.cycle_id,
            "cycle_at": self.cycle_at,
            "aoi_bbox": self.aoi_bbox,
            "scenes_searched": self.scenes_searched,
            "scenes_used": self.scenes_used,
            "observations": [o.to_dict() for o in self.observations],
            "errors": self.errors,
        }


def load_parcels(parcels_path: Path) -> tuple[list[dict], dict]:
    """Load parcels.json. Returns (parcels list, bounds dict)."""
    data = json.loads(parcels_path.read_text())
    return data["parcels"], data["bounds"]


def aoi_bbox_from_parcels(bounds: dict) -> list[float]:
    """Combined AOI bbox in [west, south, east, north]."""
    return [
        bounds["sw"]["lng"],
        bounds["sw"]["lat"],
        bounds["ne"]["lng"],
        bounds["ne"]["lat"],
    ]


def parcel_bbox(lat: float, lng: float, half_deg: float = PARCEL_HALF_DEG) -> list[float]:
    """Per-parcel bbox [west, south, east, north]."""
    return [lng - half_deg, lat - half_deg, lng + half_deg, lat + half_deg]


def search_scenes(
    aoi_bbox: list[float],
    cloud_cover_max: float = DEFAULT_CLOUD_COVER_MAX,
    window_days: int = DEFAULT_WINDOW_DAYS,
    end_datetime: datetime | None = None,
) -> list[Any]:
    """Search Sentinel-2 L2A scenes intersecting AOI."""
    end_dt = end_datetime or datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=window_days)

    catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    search = catalog.search(
        collections=[SENTINEL_COLLECTION],
        bbox=aoi_bbox,
        datetime=f"{start_dt.isoformat()}/{end_dt.isoformat()}",
        query={"eo:cloud_cover": {"lt": cloud_cover_max}},
    )
    items = list(search.items())
    # Sort by datetime descending so freshest is first
    items.sort(key=lambda it: it.datetime, reverse=True)
    return items


def pick_best_scene(scenes: list[Any]) -> Any | None:
    """Pick the most recent scene with lowest cloud cover. Returns None if no scenes."""
    if not scenes:
        return None
    # The list is already sorted newest-first. Return the first one.
    # Could refine: among scenes within the last 14 days, pick lowest cloud cover.
    return scenes[0]


def read_band_window(band_href: str, bbox: list[float]) -> np.ndarray:
    """Read a single Sentinel-2 band, clipped to bbox (in lon/lat)."""
    with rasterio.open(band_href) as src:
        # Sentinel COGs are in UTM. Reproject the bbox into the source CRS.
        from rasterio.warp import transform_bounds

        src_crs = src.crs
        west, south, east, north = transform_bounds("EPSG:4326", src_crs, *bbox, densify_pts=21)
        window = from_bounds(west, south, east, north, src.transform)
        # Read the window. Round window to int pixels.
        data = src.read(1, window=window.round_offsets().round_lengths())
        return data.astype(np.float32)


def compute_ndvi_evi(red: np.ndarray, nir: np.ndarray, blue: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute NDVI and EVI arrays.
    NDVI = (NIR - RED) / (NIR + RED)
    EVI  = 2.5 * (NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1)
    Sentinel-2 reflectance is scaled 0-10000.
    """
    # Sentinel-2 L2A surface reflectance is scaled by 10000.
    r = red / 10000.0
    n = nir / 10000.0
    b = blue / 10000.0

    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (n - r) / (n + r)
        evi = 2.5 * (n - r) / (n + 6.0 * r - 7.5 * b + 1.0)

    # Clip to valid range
    ndvi = np.clip(ndvi, -1.0, 1.0)
    evi = np.clip(evi, -1.0, 1.0)

    # Mask invalid pixels (zero or negative reflectance — usually nodata)
    mask = (red > 0) & (nir > 0) & (blue > 0)
    ndvi = np.where(mask, ndvi, np.nan)
    evi = np.where(mask, evi, np.nan)
    return ndvi, evi


def percentile_stretch(arr: np.ndarray, lo: float = 2.0, hi: float = 98.0) -> np.ndarray:
    """Percentile stretch a band to 0-255 for display."""
    valid = arr[arr > 0]
    if valid.size == 0:
        return np.zeros_like(arr, dtype=np.uint8)
    p_lo, p_hi = np.percentile(valid, [lo, hi])
    if p_hi <= p_lo:
        p_hi = p_lo + 1
    out = np.clip((arr - p_lo) / (p_hi - p_lo), 0, 1)
    return (out * 255).astype(np.uint8)


def render_rgb_preview(red: np.ndarray, green: np.ndarray, blue: np.ndarray) -> Image.Image:
    """Render true-color RGB preview from B04/B03/B02."""
    r = percentile_stretch(red)
    g = percentile_stretch(green)
    b = percentile_stretch(blue)
    rgb = np.stack([r, g, b], axis=-1)
    return Image.fromarray(rgb, mode="RGB")


def render_ndvi_preview(ndvi: np.ndarray) -> Image.Image:
    """Render NDVI as a grayscale preview where higher NDVI = brighter."""
    ndvi_clean = np.where(np.isnan(ndvi), 0, ndvi)
    # Map -1..1 to 0..255
    arr = ((ndvi_clean + 1.0) / 2.0 * 255).astype(np.uint8)
    return Image.fromarray(arr, mode="L")


def observe_one_parcel(
    parcel: dict,
    scene: Any,
    output_dir: Path | None = None,
) -> ParcelObservation:
    """Compute NDVI/EVI for one parcel from a chosen Sentinel scene."""
    bbox = parcel_bbox(parcel["lat"], parcel["lng"])

    # Determine satellite name and capture datetime from the STAC item.
    capture_dt = scene.datetime.isoformat() if scene.datetime else ""
    platform = scene.properties.get("platform", "sentinel-2")
    cloud_cover = float(scene.properties.get("eo:cloud_cover", 0.0))
    scene_id = scene.id

    obs = ParcelObservation(
        parcel_address=parcel["address"],
        parcel_number=parcel["parcelNumber"],
        lat=parcel["lat"],
        lng=parcel["lng"],
        ndvi_mean=float("nan"),
        ndvi_std=float("nan"),
        ndvi_min=float("nan"),
        ndvi_max=float("nan"),
        evi_mean=float("nan"),
        cloud_cover=cloud_cover,
        capture_datetime=capture_dt,
        scene_id=scene_id,
        satellite=platform,
        bbox=bbox,
        pixel_count=0,
    )

    try:
        red = read_band_window(scene.assets["B04"].href, bbox)
        green = read_band_window(scene.assets["B03"].href, bbox)
        blue = read_band_window(scene.assets["B02"].href, bbox)
        nir = read_band_window(scene.assets["B08"].href, bbox)

        # Resample green to red shape if shapes differ (rare on co-registered L2A
        # but defensive)
        if red.shape != nir.shape:
            obs.error = f"shape mismatch: red {red.shape} vs nir {nir.shape}"
            return obs

        ndvi, evi = compute_ndvi_evi(red, nir, blue)

        obs.pixel_count = int(np.count_nonzero(~np.isnan(ndvi)))
        if obs.pixel_count == 0:
            obs.error = "no valid pixels"
            return obs

        obs.ndvi_mean = float(np.nanmean(ndvi))
        obs.ndvi_std = float(np.nanstd(ndvi))
        obs.ndvi_min = float(np.nanmin(ndvi))
        obs.ndvi_max = float(np.nanmax(ndvi))
        obs.evi_mean = float(np.nanmean(evi))

        if output_dir is not None:
            output_dir.mkdir(parents=True, exist_ok=True)
            stem = f"{parcel['parcelNumber']}_{capture_dt[:10]}"

            rgb_img = render_rgb_preview(red, green, blue)
            preview_path = output_dir / f"{stem}_rgb.png"
            rgb_img.save(preview_path)
            obs.preview_local_path = str(preview_path)

            ndvi_img = render_ndvi_preview(ndvi)
            ndvi_path = output_dir / f"{stem}_ndvi.png"
            ndvi_img.save(ndvi_path)
            obs.raster_local_path = str(ndvi_path)

    except Exception as e:  # noqa: BLE001
        logger.exception("error processing parcel %s: %s", parcel["address"], e)
        obs.error = f"{type(e).__name__}: {e}"

    return obs


def run_cycle(
    parcels_path: Path,
    output_dir: Path | None = None,
    cloud_cover_max: float = DEFAULT_CLOUD_COVER_MAX,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> ObservationCycle:
    """Run a complete observation cycle for all parcels."""
    parcels, bounds = load_parcels(parcels_path)
    aoi = aoi_bbox_from_parcels(bounds)
    cycle_at = datetime.now(timezone.utc).isoformat()
    cycle_id = f"sat-{int(datetime.now(timezone.utc).timestamp())}"

    errors: list[str] = []
    observations: list[ParcelObservation] = []

    try:
        scenes = search_scenes(aoi, cloud_cover_max=cloud_cover_max, window_days=window_days)
        logger.info("found %d candidate scenes", len(scenes))
    except Exception as e:  # noqa: BLE001
        logger.exception("STAC search failed")
        return ObservationCycle(
            cycle_id=cycle_id,
            cycle_at=cycle_at,
            aoi_bbox=aoi,
            scenes_searched=0,
            scenes_used=0,
            observations=[],
            errors=[f"STAC search failed: {e}"],
        )

    scene = pick_best_scene(scenes)
    if scene is None:
        return ObservationCycle(
            cycle_id=cycle_id,
            cycle_at=cycle_at,
            aoi_bbox=aoi,
            scenes_searched=0,
            scenes_used=0,
            observations=[],
            errors=[
                f"no scenes within {window_days} days under {cloud_cover_max}% cloud cover"
            ],
        )

    for parcel in parcels:
        obs = observe_one_parcel(parcel, scene, output_dir=output_dir)
        observations.append(obs)
        if obs.error:
            errors.append(f"{parcel['address']}: {obs.error}")

    return ObservationCycle(
        cycle_id=cycle_id,
        cycle_at=cycle_at,
        aoi_bbox=aoi,
        scenes_searched=len(scenes),
        scenes_used=1,
        observations=observations,
        errors=errors,
    )


def cycle_to_json(cycle: ObservationCycle) -> str:
    """Serialize a cycle to JSON."""
    return json.dumps(cycle.to_dict(), indent=2, default=str)
