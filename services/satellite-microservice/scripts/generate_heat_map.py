#!/usr/bin/env python3
"""
Pull Landsat 8/9 Collection 2 Level 2 thermal data for Detroit, compute
Land Surface Temperature (LST), and render a colored heat map.

Output:
  site/images/heat-map/detroit-lst.png       — full Detroit metro thermal map
  site/images/heat-map/chadsey-lst.png       — closeup of Chadsey-Condon area
  site/images/heat-map/detroit-context.png   — true-color reference for the same area
  site/images/heat-map/metadata.json         — scene metadata

Landsat 8/9 L2 surface temperature:
  Band 10 (ST_B10) DN -> Kelvin via: K = DN * 0.00341802 + 149.0
  Resolution: 30 m/pixel
  Revisit: ~16 days per satellite (8 days combined L8 + L9)

Run:
  python3 scripts/generate_heat_map.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
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

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
OUT_DIR = PROJECT_ROOT / "site" / "images" / "heat-map"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Detroit city + close suburbs bbox
DETROIT_BBOX = [-83.30, 42.18, -82.90, 42.45]
# Chadsey-Condon closeup
CHADSEY_BBOX = [-83.13, 42.32, -83.07, 42.36]

# Chadsey-Condon center for annotation
CHADSEY_LAT = 42.34174
CHADSEY_LON = -83.10007

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"


def find_summer_scene(bbox, year_min=2023, year_max=2026, cloud_max=20):
    """Find the most recent low-cloud summer Landsat scene covering the bbox."""
    from shapely.geometry import shape, Point  # noqa: PLC0415

    centroid = Point((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)

    catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    candidates = []
    # Search summer windows (June-August) for recent years
    for year in range(year_max, year_min - 1, -1):
        start = f"{year}-06-01T00:00:00Z"
        end = f"{year}-09-15T00:00:00Z"
        search = catalog.search(
            collections=["landsat-c2-l2"],
            bbox=bbox,
            datetime=f"{start}/{end}",
            query={
                "eo:cloud_cover": {"lt": cloud_max},
                "platform": {"in": ["landsat-8", "landsat-9"]},
            },
        )
        items = list(search.items())
        contained = [it for it in items if it.geometry and shape(it.geometry).contains(centroid)]
        if contained:
            candidates.extend(contained)
    if not candidates:
        raise RuntimeError(
            f"no Landsat summer scenes found for {bbox} between {year_min}-{year_max}"
        )
    # Prefer most recent, then lowest cloud cover within same season
    candidates.sort(
        key=lambda it: (it.datetime, -it.properties.get("eo:cloud_cover", 0)), reverse=True
    )
    return candidates[0]


def read_window(href, bbox):
    with rasterio.open(href) as src:
        west, south, east, north = transform_bounds(
            "EPSG:4326", src.crs, *bbox, densify_pts=21
        )
        window = from_bounds(west, south, east, north, src.transform)
        rounded = window.round_offsets().round_lengths()
        clipped = rounded.intersection(rasterio.windows.Window(0, 0, src.width, src.height))
        data = src.read(1, window=clipped)
        if data.size == 0:
            raise RuntimeError(f"empty read window for bbox {bbox}")
        return data.astype(np.float32)


def dn_to_kelvin(dn: np.ndarray) -> np.ndarray:
    """Landsat L2 ST_B10 DN -> Kelvin."""
    K = dn * 0.00341802 + 149.0
    # Mask invalid (nodata = 0)
    K = np.where(dn > 0, K, np.nan)
    return K


def kelvin_to_fahrenheit(K: np.ndarray) -> np.ndarray:
    return (K - 273.15) * 9.0 / 5.0 + 32.0


def render_lst(scene, bbox, out_path: Path, title: str, annotate_chadsey: bool = False):
    href = scene.assets["lwir11"].href
    dn = read_window(href, bbox)
    K = dn_to_kelvin(dn)
    F = kelvin_to_fahrenheit(K)

    fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
    # Clip color range to robust percentiles to avoid outliers blowing the scale
    valid = F[~np.isnan(F)]
    if valid.size == 0:
        raise RuntimeError("no valid LST pixels")
    vmin, vmax = np.percentile(valid, [2, 98])
    im = ax.imshow(
        F,
        cmap="inferno",  # black -> red -> yellow -> white = cool to hot, classic heat map
        vmin=vmin,
        vmax=vmax,
        extent=[bbox[0], bbox[2], bbox[1], bbox[3]],
    )
    ax.set_title(title, color="#D2D6C1", fontsize=12)
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")

    cbar = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.03)
    cbar.set_label("Land Surface Temperature (°F)", color="#c8ccb8")
    cbar.ax.yaxis.set_tick_params(color="#c8ccb8")
    plt.setp(plt.getp(cbar.ax.axes, "yticklabels"), color="#c8ccb8")

    if annotate_chadsey:
        ax.scatter(
            [CHADSEY_LON], [CHADSEY_LAT],
            s=120, marker="o", facecolors="none", edgecolors="#8DA667", linewidths=2,
            zorder=10,
        )
        ax.annotate(
            "Chadsey-Condon",
            xy=(CHADSEY_LON, CHADSEY_LAT),
            xytext=(CHADSEY_LON - 0.04, CHADSEY_LAT + 0.02),
            color="#D2D6C1",
            fontsize=10,
            arrowprops={"arrowstyle": "->", "color": "#8DA667", "lw": 1.2},
        )

    ax.set_facecolor("#1A1C14")
    fig.patch.set_facecolor("#1A1C14")
    ax.tick_params(colors="#c8ccb8")
    ax.xaxis.label.set_color("#c8ccb8")
    ax.yaxis.label.set_color("#c8ccb8")
    for spine in ax.spines.values():
        spine.set_edgecolor("#8DA667")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, facecolor=fig.get_facecolor())
    plt.close(fig)
    return float(np.nanmean(F)), float(vmin), float(vmax)


def render_truecolor(scene, bbox, out_path: Path, title: str):
    """True-color reference for context (Landsat bands 4/3/2 = R/G/B)."""
    red = read_window(scene.assets["red"].href, bbox)
    green = read_window(scene.assets["green"].href, bbox)
    blue = read_window(scene.assets["blue"].href, bbox)

    def stretch(arr, lo=2, hi=98):
        valid = arr[arr > 0]
        if valid.size == 0:
            return np.zeros_like(arr, dtype=np.uint8)
        p_lo, p_hi = np.percentile(valid, [lo, hi])
        if p_hi <= p_lo:
            p_hi = p_lo + 1
        out = np.clip((arr - p_lo) / (p_hi - p_lo), 0, 1)
        return (out * 255).astype(np.uint8)

    rgb = np.stack([stretch(red), stretch(green), stretch(blue)], axis=-1)
    fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
    ax.imshow(rgb, extent=[bbox[0], bbox[2], bbox[1], bbox[3]])
    ax.set_title(title, color="#D2D6C1", fontsize=12)
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
    fig.savefig(out_path, dpi=150, facecolor=fig.get_facecolor())
    plt.close(fig)


def main() -> None:
    print(f"Detroit bbox:  {DETROIT_BBOX}")
    print(f"Chadsey bbox:  {CHADSEY_BBOX}")
    print()

    scene = find_summer_scene(DETROIT_BBOX)
    capture_dt = scene.datetime.isoformat() if scene.datetime else "unknown"
    cloud = scene.properties.get("eo:cloud_cover", 0)
    platform = scene.properties.get("platform", "landsat")
    print(f"Selected scene: {scene.id}")
    print(f"  date:    {capture_dt[:10]}")
    print(f"  cloud:   {cloud:.1f}%")
    print(f"  platform: {platform}")
    print()

    # Detroit metro LST
    print("Rendering Detroit LST...")
    mean_f, vmin, vmax = render_lst(
        scene,
        DETROIT_BBOX,
        OUT_DIR / "detroit-lst.png",
        f"Detroit metro Land Surface Temperature\n{platform}, {capture_dt[:10]}, {cloud:.1f}% cloud",
        annotate_chadsey=True,
    )
    print(f"  mean temp:  {mean_f:.1f}°F (range {vmin:.1f} - {vmax:.1f})")

    # Chadsey-Condon closeup LST
    print("Rendering Chadsey-Condon LST...")
    mean_c, vmin_c, vmax_c = render_lst(
        scene,
        CHADSEY_BBOX,
        OUT_DIR / "chadsey-lst.png",
        f"Chadsey-Condon Land Surface Temperature\n{platform}, {capture_dt[:10]}",
    )
    print(f"  mean temp:  {mean_c:.1f}°F (range {vmin_c:.1f} - {vmax_c:.1f})")

    # True-color context for Detroit
    print("Rendering Detroit true-color reference...")
    render_truecolor(
        scene,
        DETROIT_BBOX,
        OUT_DIR / "detroit-context.png",
        f"Detroit, true-color reference ({platform}, {capture_dt[:10]})",
    )

    meta = {
        "scene_id": scene.id,
        "platform": platform,
        "capture_datetime": capture_dt,
        "cloud_cover": float(cloud),
        "detroit_bbox": DETROIT_BBOX,
        "chadsey_bbox": CHADSEY_BBOX,
        "detroit_mean_lst_f": mean_f,
        "detroit_min_lst_f": vmin,
        "detroit_max_lst_f": vmax,
        "chadsey_mean_lst_f": mean_c,
        "chadsey_min_lst_f": vmin_c,
        "chadsey_max_lst_f": vmax_c,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    (OUT_DIR / "metadata.json").write_text(json.dumps(meta, indent=2))
    print(f"\nMetadata written: {OUT_DIR / 'metadata.json'}")
    print(f"\nDone. Files in: {OUT_DIR}")


if __name__ == "__main__":
    main()
