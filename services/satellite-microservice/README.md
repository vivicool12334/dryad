# Dryad Satellite Microservice

Sentinel-2 NDVI / EVI observation pipeline for Dryad's nine Chadsey-Condon parcels.

Pulls free imagery from **Microsoft Planetary Computer**, computes per-parcel vegetation indices, optionally pins previews to **web3.storage** (free tier).

## Endpoints

- `GET /health` - liveness + IPFS configuration probe
- `POST /observe` - run a satellite cycle, return JSON
- `GET /` - service metadata

## Local development

```bash
pip install -r requirements.txt
python3 scripts/observe_local.py --window-days 30 --cloud-cover-max 30
# or run the API directly
uvicorn main:app --host 0.0.0.0 --port 9006 --reload
```

## Docker

```bash
docker compose up --build -d
curl http://localhost:9006/health
curl -X POST http://localhost:9006/observe \
    -H 'Content-Type: application/json' \
    -d '{"cloud_cover_max": 20, "window_days": 14, "pin_to_ipfs": true}'
```

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `WEB3_STORAGE_TOKEN` | (empty) | If unset, pinning is silently skipped |
| `IPFS_GATEWAY` | `https://w3s.link/ipfs/` | Public gateway URL prefix |
| `PARCELS_PATH` | `/app/parcels.json` | |
| `OUTPUT_DIR` | `/app/output` | |
| `LOG_LEVEL` | `INFO` | |

## Hetzner deployment

1. SSH into the Hetzner box that runs Dryad.
2. `cd /path/to/dryad-eliza/services/satellite-microservice`
3. Set `WEB3_STORAGE_TOKEN` in `.env` (or skip — local-only mode also works)
4. `docker compose up --build -d`
5. Verify: `curl http://localhost:9006/health`

The Dryad agent (running on the same box) calls `http://localhost:9006/observe`.

## Cost

- Microsoft Planetary Computer: **free**
- web3.storage: **free tier** (5 GB)
- Compute: trivial — runs once a week, 30-90 seconds per cycle

## Notes

- Sentinel-2 has 5-day revisit. Weekly cadence always has fresh data.
- 10m/pixel resolution = trends + biomass, NOT species ID.
- Each parcel ~30m × 30m yields ~12 pixels per band per scene.
