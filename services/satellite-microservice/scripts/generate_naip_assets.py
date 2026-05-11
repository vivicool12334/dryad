#!/usr/bin/env python3
"""
Pull NAIP 1m / 60cm aerial imagery for the 9 parcels and render high-res
reference views. NAIP is free, US-only, refreshed every 2-3 years.

Generated:
  site/images/satellite/naip-wide.png       — ~2.6 km wide, full color
  site/images/satellite/naip-parcels.png    — closeup with parcels outlined
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np
import planetary_computer
import pystac_client
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from satellite import percentile_stretch  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PARCELS_PATH = Path(__file__).resolve().parent.parent / "parcels.json"
OUT_DIR = PROJECT_ROOT / "site" / "images" / "satellite"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CENTER_LAT = 42.34174
CENTER_LON = -83.10007
WIDE_HALF_DEG = 0.012
CLOSEUP_HALF_DEG = 0.0018

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"


def latest_naip_scene(bbox):
    from shapely.geometry import shape, Point  # noqa: PLC0415

    centroid = Point((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)

    catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    search = catalog.search(collections=["naip"], bbox=bbox)
    items = list(search.items())
    contained = [it for it in items if it.geometry and shape(it.geometry).contains(centroid)]
    if not contained:
        raise RuntimeError("no NAIP scenes contain centroid")
    contained.sort(key=lambda it: it.datetime, reverse=True)
    return contained[0]


def read_window(href, bbox):
    with rasterio.open(href) as src:
        west, south, east, north = transform_bounds(
            "EPSG:4326", src.crs, *bbox, densify_pts=21
        )
        window = from_bounds(west, south, east, north, src.transform)
        rounded = window.round_offsets().round_lengths()
        clipped = rounded.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        # Read all 4 NAIP bands (R, G, B, NIR) together
        data = src.read(window=clipped)  # shape: (4, H, W)
        if data.size == 0:
            raise RuntimeError(f"empty read window for bbox {bbox}")
        return data.astype(np.float32)


def render_rgb(scene, bbox, out_path: Path, title: str, parcels: list[dict] | None = None):
    bands = read_window(scene.assets["image"].href, bbox)
    # NAIP band order: 1=Red, 2=Green, 3=Blue, 4=NIR
    red = bands[0]
    green = bands[1]
    blue = bands[2]
    rgb = np.stack(
        [percentile_stretch(red), percentile_stretch(green), percentile_stretch(blue)],
        axis=-1,
    )
    fig, ax = plt.subplots(figsize=(8, 8), dpi=160)
    ax.imshow(rgb, extent=[bbox[0], bbox[2], bbox[1], bbox[3]])
    ax.set_title(title, color="#D2D6C1")
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    if parcels:
        for p in parcels:
            half = 0.00018
            rect = mpatches.Rectangle(
                (p["lng"] - half, p["lat"] - half),
                half * 2,
                half * 2,
                linewidth=2,
                edgecolor="#E29E4B",
                facecolor="none",
            )
            ax.add_patch(rect)
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
    return rgb.shape


def main() -> None:
    parcels = json.loads(PARCELS_PATH.read_text())["parcels"]

    closeup_bbox = [
        CENTER_LON - CLOSEUP_HALF_DEG,
        CENTER_LAT - CLOSEUP_HALF_DEG,
        CENTER_LON + CLOSEUP_HALF_DEG,
        CENTER_LAT + CLOSEUP_HALF_DEG,
    ]
    wide_bbox = [
        CENTER_LON - WIDE_HALF_DEG,
        CENTER_LAT - WIDE_HALF_DEG,
        CENTER_LON + WIDE_HALF_DEG,
        CENTER_LAT + WIDE_HALF_DEG,
    ]

    print("Searching NAIP...")
    scene = latest_naip_scene(closeup_bbox)
    capture_dt = scene.datetime.isoformat() if scene.datetime else "unknown"
    print(f"Selected: {scene.id}  date={capture_dt[:10]}")

    title_suffix = f"NAIP aerial, {capture_dt[:10]}, ~60 cm/pixel"
    shape = render_rgb(scene, wide_bbox, OUT_DIR / "naip-wide.png", title_suffix)
    print(f"  naip-wide.png       shape={shape}")

    shape = render_rgb(
        scene,
        closeup_bbox,
        OUT_DIR / "naip-parcels.png",
        f"{title_suffix} — 9 parcels outlined",
        parcels=parcels,
    )
    print(f"  naip-parcels.png    shape={shape}")

    # Update metadata
    meta_path = OUT_DIR / "metadata.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["naip"] = {
        "scene_id": scene.id,
        "capture_datetime": capture_dt,
        "resolution_cm": 60,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
    meta_path.write_text(json.dumps(meta, indent=2))

    print(f"\nDone. {OUT_DIR}")


if __name__ == "__main__":
    main()
