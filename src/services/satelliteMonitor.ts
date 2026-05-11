/**
 * Satellite monitoring client + persistence.
 *
 * Talks to the Python microservice (services/satellite-microservice) over
 * HTTP, fetches the latest Sentinel-2 cycle for the 9 parcels, persists
 * one JSONL record per cycle, and exposes trend deltas.
 *
 * The microservice URL is configurable via SATELLITE_SERVICE_URL.
 * Default: http://localhost:9006 (same Hetzner box as the agent).
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@elizaos/core';
import { appendJsonlRecord, readJsonlRecords } from '../utils/jsonlLog.ts';
import { getErrorMessage } from '../utils/fileErrors.ts';

export const SATELLITE_SERVICE_URL =
  process.env.SATELLITE_SERVICE_URL || 'http://localhost:9006';

export const SATELLITE_REQUEST_TIMEOUT_MS = 180_000; // 3 minutes — STAC + raster fetch

export interface SatelliteParcelObservation {
  parcel_address: string;
  parcel_number: string;
  lat: number;
  lng: number;
  ndvi_mean: number;
  ndvi_std: number;
  ndvi_min: number;
  ndvi_max: number;
  evi_mean: number;
  cloud_cover: number;
  capture_datetime: string;
  scene_id: string;
  satellite: string;
  bbox: number[];
  pixel_count: number;
  raster_local_path: string | null;
  preview_local_path: string | null;
  raster_ipfs_hash: string | null;
  preview_ipfs_hash: string | null;
  raster_ipfs_url: string | null;
  preview_ipfs_url: string | null;
  error: string | null;
}

export interface SatelliteCycle {
  cycle_id: string;
  cycle_at: string;
  aoi_bbox: number[];
  scenes_searched: number;
  scenes_used: number;
  observations: SatelliteParcelObservation[];
  errors: string[];
}

export interface SatelliteObserveOptions {
  cloudCoverMax?: number;
  windowDays?: number;
  pinToIpfs?: boolean;
}

const HISTORY_PATH = path.join(process.cwd(), 'data', 'satellite-history.jsonl');
const memoryBuffer: SatelliteCycle[] = [];
const MAX_BUFFER = 200;

/** Call the microservice to run one observation cycle. */
export async function fetchSatelliteCycle(
  options: SatelliteObserveOptions = {},
): Promise<SatelliteCycle> {
  const body = {
    cloud_cover_max: options.cloudCoverMax ?? 20.0,
    window_days: options.windowDays ?? 14,
    pin_to_ipfs: options.pinToIpfs ?? true,
  };
  const url = `${SATELLITE_SERVICE_URL}/observe`;
  logger.info(`[satellite] POST ${url} ${JSON.stringify(body)}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SATELLITE_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`satellite service ${res.status}: ${text.slice(0, 300)}`);
  }
  const cycle = (await res.json()) as SatelliteCycle;
  return cycle;
}

/** Cheap health probe of the microservice. */
export async function probeSatelliteService(): Promise<{
  reachable: boolean;
  status?: string;
  ipfsConfigured?: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${SATELLITE_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      status?: string;
      ipfs?: { configured?: boolean };
    };
    return {
      reachable: true,
      status: data.status,
      ipfsConfigured: Boolean(data.ipfs?.configured),
    };
  } catch (e) {
    return { reachable: false, error: getErrorMessage(e) };
  }
}

/** Persist a cycle to data/satellite-history.jsonl. */
export function persistSatelliteCycle(cycle: SatelliteCycle): void {
  appendJsonlRecord(HISTORY_PATH, memoryBuffer, cycle, MAX_BUFFER, (error) => {
    logger.warn(
      `[satellite] failed to persist cycle, using memory buffer: ${getErrorMessage(error)}`,
    );
  });
}

/** Read all persisted cycles (memory-buffered). */
export function loadSatelliteHistory(): SatelliteCycle[] {
  const records = readJsonlRecords<SatelliteCycle>(HISTORY_PATH, (error) => {
    logger.warn(`[satellite] failed to read history: ${getErrorMessage(error)}`);
  });
  return records ?? memoryBuffer.slice();
}

export function getMostRecentCycle(): SatelliteCycle | null {
  const all = loadSatelliteHistory();
  if (all.length === 0) return null;
  return all[all.length - 1];
}

/** Find the most recent cycle whose `cycle_at` is older than `minAgeMs`. */
export function getPreviousCycle(beforeCycleId: string): SatelliteCycle | null {
  const all = loadSatelliteHistory();
  const idx = all.findIndex((c) => c.cycle_id === beforeCycleId);
  if (idx <= 0) return null;
  return all[idx - 1];
}

export interface ParcelTrendDelta {
  parcel_address: string;
  ndvi_now: number;
  ndvi_prev: number | null;
  ndvi_delta: number | null;
  days_between: number | null;
}

/** Compute per-parcel NDVI deltas vs the previous cycle. */
export function computeTrendDeltas(cycle: SatelliteCycle): ParcelTrendDelta[] {
  const all = loadSatelliteHistory();
  const idx = all.findIndex((c) => c.cycle_id === cycle.cycle_id);
  // If the cycle hasn't been persisted yet, treat the last persisted one as previous.
  const previous: SatelliteCycle | null =
    idx > 0 ? all[idx - 1] : all.length > 0 ? all[all.length - 1] : null;

  return cycle.observations.map((obs) => {
    const prevObs = previous?.observations.find(
      (o) => o.parcel_number === obs.parcel_number,
    );
    let daysBetween: number | null = null;
    if (prevObs?.capture_datetime && obs.capture_datetime) {
      const t0 = new Date(prevObs.capture_datetime).getTime();
      const t1 = new Date(obs.capture_datetime).getTime();
      if (Number.isFinite(t0) && Number.isFinite(t1)) {
        daysBetween = (t1 - t0) / 86_400_000;
      }
    }
    return {
      parcel_address: obs.parcel_address,
      ndvi_now: obs.ndvi_mean,
      ndvi_prev: prevObs?.ndvi_mean ?? null,
      ndvi_delta:
        prevObs && Number.isFinite(prevObs.ndvi_mean) && Number.isFinite(obs.ndvi_mean)
          ? obs.ndvi_mean - prevObs.ndvi_mean
          : null,
      days_between: daysBetween,
    };
  });
}

export const NDVI_ANOMALY_DROP_THRESHOLD = 0.15;
export const NDVI_ANOMALY_WINDOW_DAYS = 7;

export const WEEKLY_CYCLE_INTERVAL_DAYS = 7;
export const MONTHLY_ATTEST_INTERVAL_DAYS = 28;

/** Days since the most recent persisted cycle, or Infinity if none. */
export function daysSinceLastCycle(): number {
  const last = getMostRecentCycle();
  if (!last) return Infinity;
  const t = new Date(last.cycle_at).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

/** Days since the most recent successful attestation flush, or Infinity if none. */
export function daysSinceLastAttestationFlush(): number {
  const queue = loadAttestationQueue();
  let latest = 0;
  for (const q of queue) {
    if (q.flushed && q.flushed_at) {
      const t = new Date(q.flushed_at).getTime();
      if (Number.isFinite(t) && t > latest) latest = t;
    }
  }
  if (latest === 0) return Infinity;
  return (Date.now() - latest) / 86_400_000;
}

/** True if it has been at least WEEKLY_CYCLE_INTERVAL_DAYS since the last cycle. */
export function shouldRunWeeklyCycle(): boolean {
  return daysSinceLastCycle() >= WEEKLY_CYCLE_INTERVAL_DAYS;
}

/** True if there are pending attestations AND we have not flushed in the last MONTHLY_ATTEST_INTERVAL_DAYS. */
export function shouldFlushMonthlyAttestations(): boolean {
  if (pendingAttestationCount() === 0) return false;
  return daysSinceLastAttestationFlush() >= MONTHLY_ATTEST_INTERVAL_DAYS;
}

export interface NdviAnomaly {
  parcel_address: string;
  ndvi_now: number;
  ndvi_prev: number;
  ndvi_delta: number;
  days_between: number;
}

/** Identify parcels whose NDVI dropped > threshold over the configured window. */
export function detectAnomalies(deltas: ParcelTrendDelta[]): NdviAnomaly[] {
  const out: NdviAnomaly[] = [];
  for (const d of deltas) {
    if (
      d.ndvi_delta != null &&
      d.ndvi_prev != null &&
      d.days_between != null &&
      d.days_between > 0 &&
      d.days_between <= NDVI_ANOMALY_WINDOW_DAYS &&
      d.ndvi_delta < -NDVI_ANOMALY_DROP_THRESHOLD
    ) {
      out.push({
        parcel_address: d.parcel_address,
        ndvi_now: d.ndvi_now,
        ndvi_prev: d.ndvi_prev,
        ndvi_delta: d.ndvi_delta,
        days_between: d.days_between,
      });
    }
  }
  return out;
}

/**
 * Run a full satellite cycle, persist it, compute trend deltas and anomalies.
 * Used by both the action handler and the decision loop.
 */
export async function runSatelliteCycle(options: SatelliteObserveOptions = {}): Promise<{
  cycle: SatelliteCycle;
  deltas: ParcelTrendDelta[];
  anomalies: NdviAnomaly[];
}> {
  const cycle = await fetchSatelliteCycle(options);
  const deltas = computeTrendDeltas(cycle);
  const anomalies = detectAnomalies(deltas);
  persistSatelliteCycle(cycle);
  enqueueObservationsForAttestation(cycle);
  return { cycle, deltas, anomalies };
}

// ─────────────────────────────────────────────────────────────
// Monthly attestation batch queue
// ─────────────────────────────────────────────────────────────

const ATTESTATION_QUEUE_PATH = path.join(
  process.cwd(),
  'data',
  'satellite-attestation-queue.jsonl',
);

export interface QueuedSatelliteAttestation {
  cycle_id: string;
  observation: SatelliteParcelObservation;
  enqueued_at: string;
  flushed?: boolean;
  flushed_at?: string;
  attestation_uid?: string;
  attestation_tx?: string;
  flush_error?: string;
}

const queueBuffer: QueuedSatelliteAttestation[] = [];

/** Add observations from a cycle to the queue. Skips ones with errors. */
export function enqueueObservationsForAttestation(cycle: SatelliteCycle): void {
  for (const obs of cycle.observations) {
    if (obs.error) continue;
    const queued: QueuedSatelliteAttestation = {
      cycle_id: cycle.cycle_id,
      observation: obs,
      enqueued_at: new Date().toISOString(),
    };
    appendJsonlRecord(ATTESTATION_QUEUE_PATH, queueBuffer, queued, 5_000, (error) => {
      logger.warn(
        `[satellite] failed to enqueue attestation: ${getErrorMessage(error)}`,
      );
    });
  }
}

export function loadAttestationQueue(): QueuedSatelliteAttestation[] {
  const records = readJsonlRecords<QueuedSatelliteAttestation>(
    ATTESTATION_QUEUE_PATH,
    (error) => {
      logger.warn(`[satellite] failed to read attestation queue: ${getErrorMessage(error)}`);
    },
  );
  return records ?? queueBuffer.slice();
}

export function pendingAttestationCount(): number {
  return loadAttestationQueue().filter((q) => !q.flushed).length;
}

/**
 * Flush the queue: mint EAS attestations for every pending observation.
 * Pass a minter function so this module stays independent of the EAS module.
 *
 * Failures are logged on the queue entry but do not block the rest.
 * The queue is rewritten in place after each successful mint.
 */
export async function flushSatelliteAttestations(
  attestObservation: (params: {
    parcelAddress: string;
    parcelNumber: string;
    ndviMean: number;
    eviMean: number;
    cloudCover: number;
    captureTimestamp: number;
    sceneId: string;
    satellite: string;
    rasterIpfsHash: string;
    previewIpfsHash: string;
  }) => Promise<{ uid: string; txHash: string }>,
  options: { dryRun?: boolean; maxToFlush?: number } = {},
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  results: QueuedSatelliteAttestation[];
}> {
  const all = loadAttestationQueue();
  const pending = all.filter((q) => !q.flushed);
  const toProcess = pending.slice(0, options.maxToFlush ?? pending.length);

  let succeeded = 0;
  let failed = 0;

  for (const item of toProcess) {
    if (options.dryRun) {
      logger.info(
        `[satellite] dryRun would attest cycle=${item.cycle_id} parcel=${item.observation.parcel_address}`,
      );
      continue;
    }
    try {
      const { uid, txHash } = await attestObservation({
        parcelAddress: item.observation.parcel_address,
        parcelNumber: item.observation.parcel_number,
        ndviMean: item.observation.ndvi_mean,
        eviMean: item.observation.evi_mean,
        cloudCover: item.observation.cloud_cover,
        captureTimestamp: Math.floor(
          new Date(item.observation.capture_datetime).getTime() / 1000,
        ),
        sceneId: item.observation.scene_id,
        satellite: item.observation.satellite,
        rasterIpfsHash: item.observation.raster_ipfs_hash || '',
        previewIpfsHash: item.observation.preview_ipfs_hash || '',
      });
      item.flushed = true;
      item.flushed_at = new Date().toISOString();
      item.attestation_uid = uid;
      item.attestation_tx = txHash;
      succeeded++;
    } catch (e) {
      item.flush_error = getErrorMessage(e);
      failed++;
      logger.error(
        `[satellite] attestation failed for ${item.observation.parcel_address}: ${item.flush_error}`,
      );
    }
  }

  // Rewrite the queue file with updated statuses
  if (!options.dryRun) {
    rewriteAttestationQueue(all);
  }

  return { attempted: toProcess.length, succeeded, failed, results: toProcess };
}

function rewriteAttestationQueue(items: QueuedSatelliteAttestation[]): void {
  try {
    const dir = path.dirname(ATTESTATION_QUEUE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content =
      items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
    fs.writeFileSync(ATTESTATION_QUEUE_PATH, content);
    queueBuffer.length = 0;
    queueBuffer.push(...items.slice(-5_000));
  } catch (e) {
    logger.warn(`[satellite] failed to rewrite attestation queue: ${getErrorMessage(e)}`);
  }
}
