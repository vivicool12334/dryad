"""
Dryad Satellite Microservice — FastAPI app.

Endpoints:
  GET  /health        — liveness probe
  POST /observe       — run a satellite cycle, return JSON cycle result

Run locally:
  uvicorn main:app --host 0.0.0.0 --port 9006

Run via Docker:
  docker compose up
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from satellite import run_cycle, cycle_to_json
from ipfs import maybe_pin_observation, get_ipfs_status

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("dryad.satellite")

# Path to parcels.json (env override for container deployments)
PARCELS_PATH = Path(os.environ.get("PARCELS_PATH", "/app/parcels.json"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/app/output"))

app = FastAPI(
    title="Dryad Satellite Microservice",
    version="0.1.0",
    description="Sentinel-2 NDVI/EVI observation pipeline for Dryad parcels.",
)


class ObserveRequest(BaseModel):
    """Optional overrides for a cycle."""

    cloud_cover_max: float = Field(20.0, ge=0.0, le=100.0)
    window_days: int = Field(14, ge=1, le=365)
    pin_to_ipfs: bool = Field(
        True,
        description="Pin previews to web3.storage. Falls back to local-only if no token configured.",
    )


@app.get("/health")
def health() -> dict[str, Any]:
    parcels_exists = PARCELS_PATH.exists()
    ipfs_status = get_ipfs_status()
    return {
        "status": "ok" if parcels_exists else "missing_parcels",
        "parcels_path": str(PARCELS_PATH),
        "parcels_loaded": parcels_exists,
        "output_dir": str(OUTPUT_DIR),
        "ipfs": ipfs_status,
    }


@app.post("/observe")
def observe(req: ObserveRequest | None = None) -> dict[str, Any]:
    if req is None:
        req = ObserveRequest()
    if not PARCELS_PATH.exists():
        raise HTTPException(status_code=500, detail=f"parcels.json not found at {PARCELS_PATH}")

    log.info(
        "starting cycle: cloud_cover_max=%s window_days=%s pin_to_ipfs=%s",
        req.cloud_cover_max,
        req.window_days,
        req.pin_to_ipfs,
    )
    cycle = run_cycle(
        parcels_path=PARCELS_PATH,
        output_dir=OUTPUT_DIR,
        cloud_cover_max=req.cloud_cover_max,
        window_days=req.window_days,
    )

    if req.pin_to_ipfs:
        for obs in cycle.observations:
            maybe_pin_observation(obs)

    # Always persist the cycle JSON to disk for debugging
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / f"{cycle.cycle_id}.json").write_text(cycle_to_json(cycle))

    return cycle.to_dict()


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": "dryad-satellite-microservice",
        "version": "0.1.0",
        "endpoints": ["/health", "/observe (POST)"],
    }
