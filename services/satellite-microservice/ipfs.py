"""
IPFS pinning via web3.storage.

web3.storage's modern API (w3up) requires a UCAN-signed token; their legacy
API key endpoint is deprecated as of 2024. For Phase-4 robustness we support
TWO modes:

  1. WEB3_STORAGE_TOKEN (legacy API token) — POST to api.web3.storage/upload
  2. WEB3_STORAGE_DELEGATION + WEB3_STORAGE_AGENT_KEY — w3up-style upload
     (deferred — initial implementation is legacy-token only)

If no token is configured, pinning is silently skipped. Local file paths
remain populated on the observation, IPFS fields are left None.
"""
from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("dryad.ipfs")

WEB3_STORAGE_TOKEN = os.environ.get("WEB3_STORAGE_TOKEN", "").strip()
WEB3_STORAGE_UPLOAD_URL = "https://api.web3.storage/upload"

# Public IPFS gateway prefix. Pinning service-agnostic.
IPFS_GATEWAY = os.environ.get("IPFS_GATEWAY", "https://w3s.link/ipfs/")


def get_ipfs_status() -> dict[str, Any]:
    return {
        "configured": bool(WEB3_STORAGE_TOKEN),
        "provider": "web3.storage" if WEB3_STORAGE_TOKEN else "none",
        "gateway": IPFS_GATEWAY,
    }


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def pin_file(path: Path) -> str | None:
    """
    Upload a single file to web3.storage. Returns CID (string) or None on failure.

    web3.storage legacy upload API:
      POST https://api.web3.storage/upload
      Authorization: Bearer <TOKEN>
      Body: raw file bytes
      Response: {"cid": "bafy..."}
    """
    if not WEB3_STORAGE_TOKEN:
        log.debug("web3.storage token not set, skipping pin for %s", path)
        return None

    if not path.exists():
        log.warning("file does not exist for pinning: %s", path)
        return None

    try:
        with open(path, "rb") as f:
            resp = requests.post(
                WEB3_STORAGE_UPLOAD_URL,
                headers={
                    "Authorization": f"Bearer {WEB3_STORAGE_TOKEN}",
                    "X-NAME": path.name,
                },
                data=f.read(),
                timeout=60,
            )
        if resp.status_code != 200:
            log.warning(
                "web3.storage upload failed: %s %s", resp.status_code, resp.text[:200]
            )
            return None
        body = resp.json()
        cid = body.get("cid")
        if not cid:
            log.warning("web3.storage response missing cid: %s", body)
            return None
        log.info("pinned %s as %s", path.name, cid)
        return cid
    except Exception as e:  # noqa: BLE001
        log.exception("pin failure for %s: %s", path, e)
        return None


def maybe_pin_observation(obs) -> None:  # type: ignore[no-untyped-def]
    """
    Pin RGB preview + NDVI raster for an observation. Mutates obs in place.
    Safe to call when no IPFS provider is configured (no-op).
    """
    if not WEB3_STORAGE_TOKEN:
        return

    if obs.preview_local_path:
        cid = pin_file(Path(obs.preview_local_path))
        if cid:
            obs.preview_ipfs_hash = cid
            obs.preview_ipfs_url = f"{IPFS_GATEWAY}{cid}"
    if obs.raster_local_path:
        cid = pin_file(Path(obs.raster_local_path))
        if cid:
            obs.raster_ipfs_hash = cid
            obs.raster_ipfs_url = f"{IPFS_GATEWAY}{cid}"
