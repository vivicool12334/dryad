# Satellite Monitor — Deployment

The satellite monitor ships as **two pieces**:

1. A **Python microservice** (`services/satellite-microservice/`) that calls Microsoft Planetary Computer.
2. **TypeScript code** inside the existing elizaOS Dryad agent (`src/services/satelliteMonitor.ts`, `src/actions/checkSatelliteImagery.ts`, EAS schema additions in `src/services/easAttestation.ts`, decision-loop steps in `src/services/decisionLoop.ts`).

Both run on the existing Hetzner box. The agent talks to the microservice over `http://localhost:9006`.

## Files added

```
services/satellite-microservice/
├── parcels.json                       (mirror of src/shared/parcels.ts)
├── satellite.py                       (STAC + raster ops)
├── ipfs.py                            (web3.storage pinning)
├── main.py                            (FastAPI app)
├── scripts/observe_local.py           (CLI for ad-hoc runs)
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── README.md

src/
├── services/satelliteMonitor.ts       (HTTP client + JSONL persistence + queue)
├── actions/checkSatelliteImagery.ts   (elizaOS action)
├── services/easAttestation.ts         (EDIT — added satellite schema + attest fn)
├── services/decisionLoop.ts           (EDIT — added two new steps)
├── actions/selfAssess.ts              (EDIT — added 'satellite' to TrackedApi)
├── plugin.ts                          (EDIT — registered new action)
└── __tests__/
    ├── satelliteMonitor.smoke.ts      (Phase 3 round-trip)
    ├── satelliteAttestation.smoke.ts  (Phase 4 queue)
    └── satelliteSchedule.smoke.ts     (Phase 5 timing)
```

## Deploy steps (Hetzner)

```bash
# On your laptop:
git add services/satellite-microservice src/services/satelliteMonitor.ts \
        src/actions/checkSatelliteImagery.ts src/services/easAttestation.ts \
        src/services/decisionLoop.ts src/actions/selfAssess.ts src/plugin.ts \
        src/__tests__/satellite*.smoke.ts \
        docs/satellite-monitor-integration-plan.md \
        docs/satellite-monitor-deployment.md
git commit -m "Satellite monitor: Sentinel-2 NDVI + EAS attestations + weekly schedule"
git push

# On the Hetzner box:
ssh dryad@<your-host>
cd ~/dryad-eliza
git pull

# Microservice (separate Docker container):
cd services/satellite-microservice
# Optional: set web3.storage token (free tier; pinning is no-op without it)
echo "WEB3_STORAGE_TOKEN=<your-token>" > .env
docker compose up --build -d
curl http://localhost:9006/health   # expect status:ok

# Agent (existing Dryad service):
cd ../..
# If not already in env, add:
#   SATELLITE_SERVICE_URL=http://localhost:9006
#   SATELLITE_ALERT_EMAIL=<where-anomalies-go>  (defaults to CONTRACTOR_EMAIL)
# Restart the agent however you currently restart it (pm2 restart dryad / systemctl etc.)
```

## What happens automatically

Every time the decision loop fires (24h in production):

- **Step `satellite`** — checks `daysSinceLastCycle()`. If ≥ 7 days, runs a fresh Sentinel-2 cycle. Persists to `data/satellite-history.jsonl`. Enqueues observations for monthly attestation. If anomalies detected (NDVI drop > 0.15 in 7 days), emails alert to `SATELLITE_ALERT_EMAIL`.
- **Step `satellite_attest_flush`** — checks `daysSinceLastAttestationFlush()`. If ≥ 28 days AND there are pending observations, mints them as EAS attestations on Base mainnet (one per parcel observation). Failures are kept in the queue and retried on the next cycle.

You can also trigger a satellite check manually by typing things like:
- "check the satellite"
- "what's the NDVI?"
- "pull sentinel data"

into the Dryad chat.

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `SATELLITE_SERVICE_URL` | `http://localhost:9006` | URL of the Python microservice |
| `SATELLITE_ALERT_EMAIL` | `CONTRACTOR_EMAIL` (powahgen@gmail.com) | Where NDVI anomaly alerts go |
| `WEB3_STORAGE_TOKEN` | (empty) | If unset, pins are skipped. Local files still saved. |
| `EAS_SATELLITE_SCHEMA_UID` | (auto-registered first call) | Override only if registering elsewhere |
| `IPFS_GATEWAY` | `https://w3s.link/ipfs/` | Used in attestation `previewIpfsUrl` |

## What's onchain

Each attestation contains:
- `parcelAddress` (string)
- `parcelNumber` (string)
- `ndviX10000` (int16) — NDVI × 10000, e.g. 4640 = 0.464
- `eviX10000` (int16)
- `cloudCover` (uint8) — percent
- `captureTimestamp` (uint64) — unix seconds of the Sentinel scene
- `sceneId` (string) — Sentinel scene ID
- `satellite` (string) — "Sentinel-2A" or "Sentinel-2B"
- `rasterIpfsHash` (string) — CID of NDVI raster (or empty if pinning disabled)
- `previewIpfsHash` (string) — CID of RGB preview (or empty if pinning disabled)

View on `https://base.easscan.org/attestation/view/<uid>` after mint.

## Operating cost

| Line | Annual |
|---|---|
| Microsoft Planetary Computer | $0 |
| web3.storage (free tier, 5 GB) | $0 |
| Hetzner compute (existing CX22) | $0 marginal |
| EAS attestations on Base (~9 parcels × 13 batches/year × ~$0.05) | ~$6/yr |
| **Total added** | **~$6/yr** |

## Smoke tests

Run anytime to validate behavior:

```bash
# Phase 1 — Python pipeline against real MPC
python3 services/satellite-microservice/scripts/observe_local.py --window-days 30

# Phase 3 — TS round-trip (requires uvicorn running on :9006)
cd services/satellite-microservice && python3 -m uvicorn main:app --port 9006 &
cd ../.. && npx tsx src/__tests__/satelliteMonitor.smoke.ts

# Phase 4 — attestation queue (no real chain calls)
npx tsx src/__tests__/satelliteAttestation.smoke.ts

# Phase 5 — scheduling and anomaly logic
npx tsx src/__tests__/satelliteSchedule.smoke.ts
```

All four must print `=== ALL GREEN ===`.

## Verified working as of build

- Real Sentinel-2 scene fetched: `S2B_MSIL2A_20260423T161819_R040_T17TLG_20260423T200214`
- 9/9 parcels imaged, mean NDVI 0.431, cloud cover 12.5%
- TypeScript compile: 0 errors
- All four smoke tests: ALL GREEN
