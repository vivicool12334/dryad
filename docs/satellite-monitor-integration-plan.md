# Satellite Monitoring — Integration Plan

> Add a satellite-derived NDVI/EVI monitoring layer to Dryad's existing decision loop. Uses Sentinel-2 from Microsoft Planetary Computer. Outputs onchain attestations via the existing EAS schema pattern. ~3 days end-to-end. ~$240/year added operating cost.

---

## 1. What we're building

A new capability for the Dryad agent that:

- Pulls fresh Sentinel-2 imagery covering the 9 parcels weekly (5-day Sentinel revisit means we always have recent data)
- Filters for cloud cover under 20%, picks the latest usable scene per parcel
- Computes per-parcel NDVI (vegetation health) and EVI (biomass density)
- Produces a true-color RGB preview PNG and the raw raster
- Stores rasters + previews to IPFS
- Mints an EAS attestation per observation with structured metadata
- Tracks NDVI trend over time and surfaces anomalies (sudden drops, unexpected spikes) into the agent's existing decision loop
- Reports biomass changes in the weekly digest

**Why it matters for Dryad's pitch.** Right now the agent's biodiversity signal is iNaturalist observations — community-contributed, irregular, species-level. Satellite adds a *continuous, machine-generated, biomass-level* signal that runs whether or not anyone is photographing the lots. This is the layer that makes "investment-grade outcome verification" a real claim, not a slogan. It's also exactly the layer that the WEF UpLink primitive doc and the Knight case study deliverable both depend on.

**Non-goals (be explicit).** No species-level satellite ID. Sentinel-2 at 10m/pixel can't see individual plants on a 0.1-acre lot. Species ID stays with iNaturalist + (eventually) drones. No real-time alerting beyond the weekly cycle. No replacement for site visits — this augments ground-truth, not replaces it.

---

## 2. Architecture — where it fits

The Dryad agent already has:

- `src/actions/checkBiodiversity.ts` — iNaturalist polling, invasive scoring, native indicator scoring
- `src/services/decisionLoop.ts` — 24-hour autonomous loop that orchestrates the actions
- `src/services/easAttestation.ts` — EAS schemas + minting on Base
- `src/services/healthSnapshots.ts` — historical health score storage
- `src/shared/parcels.ts` — 9 parcel coords + bounding box

We add three new files (one action, one service, one schema extension) plus one external Python microservice. No changes to existing files except `decisionLoop.ts` (one new action call) and `easAttestation.ts` (one new schema).

**System diagram:**

```
                     ┌─────────────────────────────────────────┐
                     │         Dryad elizaOS Agent             │
                     │                                         │
                     │  decisionLoop (24h) ──► checkSatellite  │ <-- NEW action
                     │                              │          │
                     │                              ▼          │
                     │                       satelliteMonitor  │ <-- NEW service
                     │                              │          │
                     │                              │ HTTP     │
                     └──────────────────────────────┼──────────┘
                                                    │
                                                    ▼
                          ┌──────────────────────────────────┐
                          │   satellite-microservice (NEW)   │
                          │   FastAPI on Hetzner :9006       │
                          │                                  │
                          │   pystac-client ──► MS Planetary │
                          │       │            Computer STAC │
                          │       │                          │
                          │   odc-stac, rioxarray            │
                          │       │                          │
                          │   compute NDVI/EVI per parcel    │
                          │       │                          │
                          │   Pinata IPFS pin                │
                          │       │                          │
                          │   return JSON + IPFS hashes      │
                          └──────────────────────────────────┘
                                                    │
                                                    ▼
                          ┌──────────────────────────────────┐
                          │   Back in elizaOS:               │
                          │                                  │
                          │   1. Persist to local DB         │
                          │   2. Compute trend vs last week  │
                          │   3. Mint EAS attestation        │
                          │      (one batch per cycle)       │
                          │   4. Surface into weekly report  │
                          │   5. Trigger alerts on anomalies │
                          └──────────────────────────────────┘
```

---

## 3. New files (concrete)

### `src/services/satelliteMonitor.ts` (NEW)

The agent-side client to the Python microservice. Calls `/observe` with the parcel bounding box and gets back per-parcel NDVI/EVI + metadata.

```ts
export interface SatelliteObservation {
  parcelAddress: string;
  parcelNumber: string;
  ndviMean: number;       // 0-1
  ndviStd: number;
  eviMean: number;
  cloudCover: number;     // 0-100
  captureDatetime: string;  // ISO from Sentinel
  observationDatetime: string;
  scene_id: string;
  rasterIpfsHash: string;
  previewIpfsHash: string;
  satellite: 'sentinel-2a' | 'sentinel-2b';
}

export interface SatelliteCycleResult {
  cycleId: string;
  cycleAt: string;
  observations: SatelliteObservation[];
  errors: string[];
}

export async function runSatelliteCycle(): Promise<SatelliteCycleResult> { ... }
```

Storage: append to `data/satellite-history.jsonl` (same pattern as healthSnapshots).

### `src/actions/checkSatelliteImagery.ts` (NEW)

elizaOS action wrapper. Triggered weekly by decisionLoop OR by chat command "check the satellite." Calls `runSatelliteCycle`, computes trend deltas vs the previous cycle, summarizes for the agent's chat output, mints attestations.

Pattern matches `checkBiodiversity.ts` exactly — same imports, same `Action` interface, same `recordApiCall` for self-assessment tracking.

### `src/services/easAttestation.ts` (EDIT — add one schema)

Add a third schema:

```ts
const SATELLITE_OBSERVATION_SCHEMA_STRING =
  'string parcelAddress,string parcelNumber,uint16 ndviMean,uint16 eviMean,uint8 cloudCover,uint64 captureTimestamp,string sceneId,string rasterIpfsHash,string previewIpfsHash';
```

NDVI/EVI stored as uint16 (multiply by 10000, range 0-10000) to keep schema compact. Convert back on read.

Function: `attestSatelliteObservation(obs: SatelliteObservation)` — same pattern as the existing observation attestation function.

### `src/services/decisionLoop.ts` (EDIT — one new branch)

Add a "should I check satellite?" branch:

```ts
const lastSatelliteCycle = await loadLastSatelliteCycleTimestamp();
const daysSinceLast = (Date.now() - lastSatelliteCycle) / 86400000;
if (daysSinceLast >= 7) {
  await runSatelliteCycleAndAttest();
}
```

### `services/satellite-microservice/` (NEW external Python service)

Lives outside `src/` since it's Python, not TypeScript. Deployed via Docker on the same Hetzner box as the agent.

```
services/satellite-microservice/
├── Dockerfile
├── requirements.txt        # fastapi, uvicorn, pystac-client, odc-stac, rioxarray, geopandas, requests
├── main.py                 # FastAPI app, /observe endpoint
├── satellite.py            # STAC search + raster ops
├── ipfs.py                 # Pinata client
├── parcels.json            # 9 parcels (mirror of TypeScript shared data)
└── tests/
    └── test_observe.py
```

`/observe` endpoint:
- Input: list of parcels (bbox or point + radius), max cloud cover, time window
- Process: STAC search Sentinel-2 L2A on Microsoft Planetary Computer, sort by datetime desc, filter cloud cover, pick most recent usable scene per parcel
- Compute NDVI = (B08 - B04) / (B08 + B04) for each parcel polygon
- Compute EVI = 2.5 * (B08 - B04) / (B08 + 6*B04 - 7.5*B02 + 1)
- Render true-color RGB preview (B04, B03, B02 stretched 2-98 percentile)
- Pin raster (.tif) and preview (.png) to Pinata
- Return JSON with all per-parcel stats + IPFS hashes

Estimated runtime per cycle: 30-90 seconds (mostly the STAC query and asset fetch).

---

## 4. End-to-end data flow

1. **Trigger** — Tuesday 02:00 ET, decisionLoop fires, checks last satellite cycle timestamp, sees > 7 days, calls `runSatelliteCycle()`.
2. **Microservice call** — TS service POSTs to `http://localhost:9006/observe` with the 9 parcel coords + bbox.
3. **STAC search** — Microservice queries Microsoft Planetary Computer for `sentinel-2-l2a` items intersecting the bbox in the last 14 days, filters `eo:cloud_cover < 20`, sorts by `datetime` desc.
4. **Asset fetch** — Loads B02, B03, B04, B08 bands using `odc-stac` (lazy-loaded into xarray DataArrays). Clips to each parcel's small AOI (~30m × 30m around centroid).
5. **Per-parcel computation** — Per parcel: mean NDVI, std NDVI, mean EVI, generated RGB preview thumbnail.
6. **IPFS pinning** — Pinata API. Two pins per parcel (raster + preview), batched.
7. **Response** — JSON back to TS service with all stats + IPFS hashes + scene metadata.
8. **Persist** — TS service writes to `data/satellite-history.jsonl`, computes trend deltas vs last cycle.
9. **Attest** — Mint one EAS attestation per parcel observation (9 attestations per cycle, batched as a single multi-attest call to save gas).
10. **Report** — Format weekly digest line: "Sentinel-2: 9/9 parcels imaged on YYYY-MM-DD. Mean NDVI 0.62 (+0.04 vs last week). One alert: parcel 4501 NDVI dropped 0.18 in 7 days, suggest site visit."
11. **Anomaly handling** — If parcel NDVI drops by > 0.15 in a week, queue an iNaturalist double-check task and notify Nick via AgentMail.

---

## 5. EAS schema design

Already partially covered above. The full schema string:

```
string parcelAddress,
string parcelNumber,
uint16 ndviMean,        // multiply by 10000 (0.6243 -> 6243)
uint16 eviMean,         // same
uint8  cloudCover,      // percent
uint64 captureTimestamp, // unix
string sceneId,         // e.g. "S2A_MSIL2A_20260415T..."
string rasterIpfsHash,
string previewIpfsHash
```

Schema registration is one-time, like the existing `cachedSchemaUid` and `cachedObservationSchemaUid` patterns.

---

## 6. Phasing — what to build first

### Phase 1 — Standalone proof of life (~half day, no Dryad changes)

Just the Python script. Pulls Sentinel-2 for the 9 lots, computes NDVI, saves PNG previews + JSON locally. Run by hand. Validates we can get real data for Chadsey-Condon today.

**Deliverable:** A folder of 9 NDVI maps + a JSON with stats. Look at it, sanity-check it.

### Phase 2 — Microservice + Docker (~half day)

Wrap Phase 1 as FastAPI, dockerize, deploy on Hetzner alongside the agent. Test via `curl`.

**Deliverable:** `http://5.75.225.23:9006/observe` returns valid JSON.

### Phase 3 — elizaOS action (~half day)

Write `checkSatelliteImagery.ts` action + `satelliteMonitor.ts` service. Invocable via chat ("check the satellite") and stores results to JSONL. No attestation yet, no decision-loop integration yet.

**Deliverable:** Type "check the satellite" in the agent chat, get back a summary message.

### Phase 4 — IPFS + EAS attestation (~half day)

Add Pinata pinning to the microservice. Add the satellite EAS schema + minting function. Each cycle now produces 9 onchain attestations.

**Deliverable:** Look up an attestation on `base.easscan.org` and see real Sentinel-2 NDVI data.

### Phase 5 — Decision-loop integration + alerts (~half day)

Add the weekly trigger to `decisionLoop.ts`. Add anomaly detection (NDVI drop threshold). Add weekly digest line. Add AgentMail alert if anomaly fires.

**Deliverable:** Agent runs the satellite check on its own every week, surfaces results in the digest, alerts on anomalies.

Total: ~3 days of focused work. Phase 1 alone (~half day) gets us real Sentinel-2 NDVI data for Chadsey-Condon, which is enough to say "we have satellite-derived monitoring" in any pitch.

---

## 7. Operating cost (added to existing $945/yr)

| Line | Cost |
|---|---|
| Microsoft Planetary Computer | $0 (free, no API key needed) |
| Pinata IPFS pinning (250GB plan) | $20/mo = $240/yr |
| Compute (existing Hetzner CX22) | $0 marginal |
| EAS attestations on Base (9/week × 52 = 468/yr × ~$0.05 with batching) | ~$25/yr |
| **Total added** | **~$265/yr** |

Pulls from the existing $1,000 buffer in the Knight budget. Or, if Pinata is overkill: Web3.Storage is free up to 5GB (small enough for a year of weekly raster pins from 9 small parcels). Could go with Web3.Storage for $0 added cost, accepting some reliability risk.

**Recommendation: start with Web3.Storage (free), upgrade to Pinata if reliability becomes an issue.**

---

## 8. Open questions for you

1. **Microservice host language.** Python is the right choice (STAC tooling is Python-native). Confirms?
2. **IPFS pinning provider.** Web3.Storage (free, accept some reliability risk) or Pinata ($20/mo, more reliable)?
3. **Schedule.** Weekly is what I'd default to. Sentinel-2 has 5-day revisit so weekly always has fresh data. Want different?
4. **Anomaly threshold.** I proposed NDVI drop > 0.15 in 7 days as the alert trigger. Want tighter or looser?
5. **Alert channel.** AgentMail to you? Or also a Telegram/SMS hook?
6. **Attestation frequency.** Every cycle (9 attestations/week) or batched monthly (9 attestations/month, lower onchain noise)?
7. **Should I start Phase 1 now?**

---

## 9. After this lands

Tier 2 (Detroit Heat Island Map) becomes much easier because we already have the satellite plumbing — same Python service, swap Sentinel-2 visible bands for Landsat 8/9 thermal, compute LST instead of NDVI, render to a Leaflet web map. Could probably ship Tier 2 in 2 days once Tier 1 is live.

The "landscape intelligence primitive" pitch in the WEF UpLink one-pager becomes a thing we can demo, not a thing we just describe.
