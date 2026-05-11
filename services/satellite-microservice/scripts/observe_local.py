#!/usr/bin/env python3
"""
Standalone Phase-1 runner: pulls one Sentinel-2 cycle for the 9 parcels,
saves NDVI/RGB previews + JSON to ./output/.

Usage:
  python3 scripts/observe_local.py
  python3 scripts/observe_local.py --cloud-cover-max 30 --window-days 60
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Allow running from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from satellite import run_cycle, cycle_to_json  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase-1 standalone Sentinel-2 cycle for Dryad parcels")
    parser.add_argument(
        "--parcels",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "parcels.json",
        help="Path to parcels.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "output",
        help="Output directory for previews and JSON",
    )
    parser.add_argument("--cloud-cover-max", type=float, default=20.0)
    parser.add_argument("--window-days", type=int, default=30)
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    log = logging.getLogger(__name__)
    log.info("running cycle, parcels=%s output=%s", args.parcels, args.output)

    cycle = run_cycle(
        parcels_path=args.parcels,
        output_dir=args.output,
        cloud_cover_max=args.cloud_cover_max,
        window_days=args.window_days,
    )

    args.output.mkdir(parents=True, exist_ok=True)
    cycle_path = args.output / f"{cycle.cycle_id}.json"
    cycle_path.write_text(cycle_to_json(cycle))

    print()
    print(f"=== cycle {cycle.cycle_id} ===")
    print(f"scenes searched: {cycle.scenes_searched}")
    print(f"scenes used:     {cycle.scenes_used}")
    print(f"observations:    {len(cycle.observations)}")
    print(f"errors:          {len(cycle.errors)}")
    print(f"json saved:      {cycle_path}")
    print()
    if cycle.observations:
        print(f"{'parcel':<22} {'NDVI':>7} {'EVI':>7} {'cloud%':>7} {'pixels':>7}  scene")
        print("-" * 100)
        for o in cycle.observations:
            ndvi = f"{o.ndvi_mean:.3f}" if o.ndvi_mean == o.ndvi_mean else "  nan"  # NaN check
            evi = f"{o.evi_mean:.3f}" if o.evi_mean == o.evi_mean else "  nan"
            print(
                f"{o.parcel_address:<22} {ndvi:>7} {evi:>7} {o.cloud_cover:>7.1f} {o.pixel_count:>7}  {o.scene_id[:50]}"
            )
    if cycle.errors:
        print()
        print("errors:")
        for e in cycle.errors:
            print(f"  - {e}")
    return 0 if not cycle.errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
