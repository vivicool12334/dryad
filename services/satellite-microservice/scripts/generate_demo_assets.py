#!/usr/bin/env python3
"""
Generate higher-resolution Sentinel-2 demo assets for the dryad.land website.

Produces:
  site/images/satellite/wide-rgb.png       - 2km true-color of Chadsey-Condon
  site/images/satellite/wide-ndvi.png      - same area, NDVI heatmap (Red->Yellow->Green)
  site/images/satellite/parcels-rgb.png    - close-up RGB with the 9 parcels outlined
  site/images/satellite/parcels-ndvi.png   - close-up NDVI heatmap with parcels outlined
  site/images/satellite/legend-ndvi.png    - colorbar legend

Run:
  python3 scripts/generate_demo_assets.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np
import planetary_computer
import pystac_client
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from satellite import compute_ndvi_evi, percentile_stretch  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PARCELS_PATH = Path(__file__).resolve().parent.parent / "parcels.json"
OUT_DIR = PROJECT_ROOT / "site" / "images" / "satellite"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CENTER_LAT = 42.34174
CENTER_LON = -83.10007
WIDE_HALF_DEG = 0.012   # ~1.3km half-extent => 2.6km box
CLOSEUP_HALF_DEG = 0.0018  # ~200m half-extent — wide enough to give Sentinel-2 enough pixels

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"


def latest_scene(bbox, window_days=60, cloud_cover_max=30):
    """Find the most recent Sentinel-2 scene that fully contains the bbox centroid.

    STAC bbox search returns any scene that *touches* the bbox, which can include
    neighboring UTM tiles that don't actually cover our area. We filter by checking
    that the bbox CENTROID lies inside the scene's footprint geometry.
    """
    from shapely.geometry import shape, Point  # noqa: PLC0415

    centroid = Point((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=window_days)
    catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=bbox,
        datetime=f"{start_dt.isoformat()}/{end_dt.isoformat()}",
        query={"eo:cloud_cover": {"lt": cloud_cover_max}},
    )
    items = list(search.items())
    # Filter to scenes whose footprint contains the centroid
    contained = [it for it in items if it.geometry and shape(it.geometry).contains(centroid)]
    if not contained:
        raise RuntimeError(
            f"no scenes containing centroid {centroid.wkt} found (had {len(items)} touching scenes)"
        )
    contained.sort(key=lambda it: it.datetime, reverse=True)
    return contained[0]


def read_window(href, bbox):
    """Read the bbox region of the band. Returns float32 array. May raise if window is empty."""
    with rasterio.open(href) as src:
        west, south, east, north = transform_bounds(
            "EPSG:4326", src.crs, *bbox, densify_pts=21
        )
        window = from_bounds(west, south, east, north, src.transform)
        rounded = window.round_offsets().round_lengths()
        # Clip the window to the source extent so we never request rows past the bottom
        clipped = rounded.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        data = src.read(1, window=clipped)
        if data.size == 0:
            raise RuntimeError(
                f"empty read window for bbox {bbox} (scene does not cover this area)"
            )
        return data.astype(np.float32)


def render_rgb(scene, bbox, out_path: Path, title: str | None = None):
    red = read_window(scene.assets["B04"].href, bbox)
    green = read_window(scene.assets["B03"].href, bbox)
    blue = read_window(scene.assets["B02"].href, bbox)
    rgb = np.stack(
        [percentile_stretch(red), percentile_stretch(green), percentile_stretch(blue)],
        axis=-1,
    )
    fig, ax = plt.subplots(figsize=(8, 8), dpi=160)
    ax.imshow(rgb, extent=[bbox[0], bbox[2], bbox[1], bbox[3]])
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    if title:
        ax.set_title(title)
    ax.set_facecolor("#1A1C14")
    fig.patch.set_facecolor("#1A1C14")
    ax.tick_params(colors="#c8ccb8")
    ax.xaxis.label.set_color("#c8ccb8")
    ax.yaxis.label.set_color("#c8ccb8")
    if title:
        ax.title.set_color("#D2D6C1")
    for spine in ax.spines.values():
        spine.set_edgecolor("#8DA667")
    fig.tight_layout()
    fig.savefig(out_path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)
    return red.shape


def render_ndvi(scene, bbox, out_path: Path, title: str | None = None):
    red = read_window(scene.assets["B04"].href, bbox)
    blue = read_window(scene.assets["B02"].href, bbox)
    nir = read_window(scene.assets["B08"].href, bbox)
    ndvi, _ = compute_ndvi_evi(red, nir, blue)

    # Colormap: red -> yellow -> green for vegetation health
    fig, ax = plt.subplots(figsize=(8, 8), dpi=160)
    im = ax.imshow(
        ndvi,
        cmap="RdYlGn",
        vmin=-0.2,
        vmax=0.8,
        extent=[bbox[0], bbox[2], bbox[1], bbox[3]],
    )
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    if title:
        ax.set_title(title)
    ax.set_facecolor("#1A1C14")
    fig.patch.set_facecolor("#1A1C14")
    ax.tick_params(colors="#c8ccb8")
    ax.xaxis.label.set_color("#c8ccb8")
    ax.yaxis.label.set_color("#c8ccb8")
    if title:
        ax.title.set_color("#D2D6C1")
    for spine in ax.spines.values():
        spine.set_edgecolor("#8DA667")
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("NDVI (vegetation index)", color="#c8ccb8")
    cbar.ax.yaxis.set_tick_params(color="#c8ccb8")
    plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color="#c8ccb8")
    fig.tight_layout()
    fig.savefig(out_path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)
    return ndvi.shape


def overlay_parcels(parcels: list[dict], ax, half_deg=0.00018, edge_color="#E29E4B"):
    """Overlay parcel rectangles onto a matplotlib axis."""
    for p in parcels:
        west = p["lng"] - half_deg
        south = p["lat"] - half_deg
        rect = mpatches.Rectangle(
            (west, south),
            half_deg * 2,
            half_deg * 2,
            linewidth=1.5,
            edgecolor=edge_color,
            facecolor="none",
        )
        ax.add_patch(rect)


def render_closeup_with_parcels(scene, bbox, parcels: list[dict], out_path: Path, kind: str):
    red = read_window(scene.assets["B04"].href, bbox)
    blue = read_window(scene.assets["B02"].href, bbox)
    nir = read_window(scene.assets["B08"].href, bbox)
    green = read_window(scene.assets["B03"].href, bbox)

    fig, ax = plt.subplots(figsize=(8, 8), dpi=160)

    if kind == "rgb":
        rgb = np.stack(
            [percentile_stretch(red), percentile_stretch(green), percentile_stretch(blue)],
            axis=-1,
        )
        ax.imshow(rgb, extent=[bbox[0], bbox[2], bbox[1], bbox[3]])
        ax.set_title("True-color (B04 / B03 / B02), 9 parcels outlined", color="#D2D6C1")
    else:
        ndvi, _ = compute_ndvi_evi(red, nir, blue)
        im = ax.imshow(
            ndvi,
            cmap="RdYlGn",
            vmin=-0.2,
            vmax=0.8,
            extent=[bbox[0], bbox[2], bbox[1], bbox[3]],
        )
        cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
        cbar.set_label("NDVI", color="#c8ccb8")
        cbar.ax.yaxis.set_tick_params(color="#c8ccb8")
        plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color="#c8ccb8")
        ax.set_title("NDVI heatmap, 9 parcels outlined", color="#D2D6C1")

    overlay_parcels(parcels, ax)
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    ax.set_facecolor("#1A1C14")
    fig.patch.set_facecolor("#1A1C14")
    ax.tick_params(colors="#c8ccb8")
    ax.xaxis.label.set_color("#c8ccb8")
    ax.yaxis.label.set_color("#c8ccb8")
    for spine in ax.spines.values():
        spine.set_edgecolor("#8DA667")
    fig.tight_layout()
    fig.savefig(out_path, dpi=160, facecolor=fig.get_facecolor())
    plt.close(fig)


def main() -> None:
    parcels = json.loads(PARCELS_PATH.read_text())["parcels"]

    # Wide bbox: ~2.6 km × 2.6 km centered on Chadsey-Condon
    wide_bbox = [
        CENTER_LON - WIDE_HALF_DEG,
        CENTER_LAT - WIDE_HALF_DEG,
        CENTER_LON + WIDE_HALF_DEG,
        CENTER_LAT + WIDE_HALF_DEG,
    ]

    # Closeup bbox: ~360 m around the parcels (just enough to show them)
    closeup_bbox = [
        CENTER_LON - CLOSEUP_HALF_DEG,
        CENTER_LAT - CLOSEUP_HALF_DEG,
        CENTER_LON + CLOSEUP_HALF_DEG,
        CENTER_LAT + CLOSEUP_HALF_DEG,
    ]

    print(f"Closeup bbox: {closeup_bbox}")
    print(f"Wide bbox:    {wide_bbox}")
    # Search using the SMALL closeup bbox to guarantee the picked scene covers Chadsey-Condon
    print("Searching for latest Sentinel-2 scene...")
    scene = latest_scene(closeup_bbox)
    capture_dt = scene.datetime.isoformat() if scene.datetime else "unknown"
    cloud = scene.properties.get("eo:cloud_cover", 0)
    sat = scene.properties.get("platform", "Sentinel-2")
    title_suffix = f"({sat}, {capture_dt[:10]}, {cloud:.1f}% cloud)"
    print(f"Selected: {scene.id}  cloud={cloud:.1f}%")

    # Wide views
    shape = render_rgb(
        scene,
        wide_bbox,
        OUT_DIR / "wide-rgb.png",
        title=f"Chadsey-Condon, Detroit\n{title_suffix}",
    )
    print(f"  wide-rgb.png    shape={shape}")
    shape = render_ndvi(
        scene,
        wide_bbox,
        OUT_DIR / "wide-ndvi.png",
        title=f"NDVI vegetation health\n{title_suffix}",
    )
    print(f"  wide-ndvi.png   shape={shape}")

    render_closeup_with_parcels(scene, closeup_bbox, parcels, OUT_DIR / "parcels-rgb.png", "rgb")
    print("  parcels-rgb.png written")
    render_closeup_with_parcels(scene, closeup_bbox, parcels, OUT_DIR / "parcels-ndvi.png", "ndvi")
    print("  parcels-ndvi.png written")

    # Save metadata sidecar so the website can show capture date dynamically
    meta = {
        "scene_id": scene.id,
        "satellite": sat,
        "capture_datetime": capture_dt,
        "cloud_cover": float(cloud),
        "wide_bbox": wide_bbox,
        "closeup_bbox": closeup_bbox,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print(f"\nmetadata.json written")
    print(f"\nDone. Files in: {OUT_DIR}")


if __name__ == "__main__":
    main()
