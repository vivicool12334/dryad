#!/usr/bin/env python3
"""
Convert data/satellite-history.jsonl (one JSON object per line) into a
static JSON array at site/satellite-history.json that the satellite.html
page can fetch directly.

Run after each cycle, or as a post-cycle hook from the agent.

  python3 services/satellite-microservice/scripts/export_history.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SRC = PROJECT_ROOT / "data" / "satellite-history.jsonl"
DST = PROJECT_ROOT / "site" / "satellite-history.json"


def main() -> int:
    if not SRC.exists():
        print(f"No history file at {SRC}; writing empty array.")
        DST.parent.mkdir(parents=True, exist_ok=True)
        DST.write_text("[]\n")
        return 0

    cycles: list[dict] = []
    for line in SRC.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"Skipping bad line: {e}", file=sys.stderr)
            continue
        # Filter out smoke-test rows. Real cycles have observations with at least
        # 9 parcels.
        observations = obj.get("observations", [])
        if not observations:
            continue
        # Skip rows that look like smoke-test / placeholder cycles (single obs, fake scene id)
        if len(observations) < 5 and obj.get("cycle_id", "").startswith("sat-test"):
            continue
        if len(observations) < 5 and obj.get("cycle_id", "") == "sat-old":
            continue
        cycles.append(obj)

    cycles.sort(key=lambda c: c.get("cycle_at", ""))
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(json.dumps(cycles, indent=2))
    print(f"Wrote {len(cycles)} cycle(s) to {DST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
