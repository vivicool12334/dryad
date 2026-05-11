/**
 * Phase-4 smoke test: queue + flush with a stubbed EAS minter.
 *
 * Validates:
 *   - enqueueObservationsForAttestation persists items
 *   - pendingAttestationCount counts un-flushed items
 *   - flushSatelliteAttestations runs through the queue, marks items flushed,
 *     skips errored items, persists results
 *   - Re-running flush on an empty queue is a no-op
 *
 * No real EAS calls — the stub returns predictable uids.
 *
 *   npx tsx src/__tests__/satelliteAttestation.smoke.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  enqueueObservationsForAttestation,
  flushSatelliteAttestations,
  loadAttestationQueue,
  pendingAttestationCount,
  type SatelliteCycle,
} from '../services/satelliteMonitor.ts';
import { encodeIndexAsInt16 } from '../services/easAttestation.ts';

function fakeCycle(id: string): SatelliteCycle {
  const baseObs = {
    parcel_address: '4475 25th St',
    parcel_number: '12009490',
    lat: 42.34143,
    lng: -83.09995,
    ndvi_mean: 0.464,
    ndvi_std: 0.063,
    ndvi_min: 0.353,
    ndvi_max: 0.551,
    evi_mean: 0.521,
    cloud_cover: 12.5,
    capture_datetime: '2026-04-23T16:18:19Z',
    scene_id: 'S2B_MSIL2A_20260423T161819',
    satellite: 'Sentinel-2B',
    bbox: [-83.10013, 42.34125, -83.09977, 42.34161],
    pixel_count: 12,
    raster_local_path: '/tmp/raster.png',
    preview_local_path: '/tmp/preview.png',
    raster_ipfs_hash: 'bafy_raster_test',
    preview_ipfs_hash: 'bafy_preview_test',
    raster_ipfs_url: 'https://w3s.link/ipfs/bafy_raster_test',
    preview_ipfs_url: 'https://w3s.link/ipfs/bafy_preview_test',
    error: null,
  };
  return {
    cycle_id: id,
    cycle_at: new Date().toISOString(),
    aoi_bbox: [-83.1007, 42.3411, -83.0994, 42.3424],
    scenes_searched: 2,
    scenes_used: 1,
    observations: [
      { ...baseObs, parcel_address: '4475 25th St', parcel_number: '12009490' },
      { ...baseObs, parcel_address: '4481 25th St', parcel_number: '12009489', ndvi_mean: 0.411 },
      { ...baseObs, parcel_address: '4487 25th St', parcel_number: '12009488', error: 'cloudy' },
    ],
    errors: ['4487 25th St: cloudy'],
  };
}

async function main(): Promise<void> {
  console.log('=== Phase-4 satellite attestation queue smoke test ===\n');

  // Reset queue file (truncate, not unlink — sandbox forbids unlink)
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'satellite-attestation-queue.jsonl'), '');

  // 1. Encoding sanity
  console.log('[1] encodeIndexAsInt16 sanity:');
  const cases: Array<[number, number]> = [
    [0.464, 4640],
    [-1.0, -10000],
    [1.0, 10000],
    [0.0, 0],
    [Number.NaN, 0],
    [5.0, 32767], // clamps to int16 max
  ];
  for (const [input, expected] of cases) {
    const actual = encodeIndexAsInt16(input);
    const ok = actual === expected;
    console.log(`    ${input} -> ${actual} (expected ${expected})  ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) process.exit(1);
  }

  // 2. Enqueue
  console.log('\n[2] enqueueObservationsForAttestation:');
  const cycleA = fakeCycle('sat-test-A');
  enqueueObservationsForAttestation(cycleA);
  const after1 = loadAttestationQueue();
  console.log(`    queue length:     ${after1.length} (expected 2 — third had error)`);
  if (after1.length !== 2) process.exit(1);
  console.log(`    pending count:    ${pendingAttestationCount()}`);
  if (pendingAttestationCount() !== 2) process.exit(1);

  // Enqueue a second cycle
  const cycleB = fakeCycle('sat-test-B');
  enqueueObservationsForAttestation(cycleB);
  console.log(`    after 2nd cycle:  ${loadAttestationQueue().length} (expected 4)`);
  if (loadAttestationQueue().length !== 4) process.exit(1);

  // 3. Dry-run flush
  console.log('\n[3] flushSatelliteAttestations dryRun:');
  const dry = await flushSatelliteAttestations(
    async () => {
      throw new Error('should not be called in dry run');
    },
    { dryRun: true },
  );
  console.log(`    attempted=${dry.attempted} succeeded=${dry.succeeded} failed=${dry.failed}`);
  if (dry.attempted !== 4 || dry.succeeded !== 0 || dry.failed !== 0) process.exit(1);
  if (pendingAttestationCount() !== 4) {
    console.error('    dry run incorrectly modified queue');
    process.exit(1);
  }

  // 4. Real flush with a stubbed mint function (one will fail intentionally)
  console.log('\n[4] flushSatelliteAttestations with stub:');
  let callCount = 0;
  const result = await flushSatelliteAttestations(async () => {
    callCount++;
    if (callCount === 3) throw new Error('simulated chain glitch');
    return { uid: `0xfake_uid_${callCount}`, txHash: `0xfake_tx_${callCount}` };
  });
  console.log(`    attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`);
  if (result.attempted !== 4 || result.succeeded !== 3 || result.failed !== 1) process.exit(1);

  // After flush: 0 pending (the one that failed should be retryable but isn't marked flushed)
  const queueAfterFlush = loadAttestationQueue();
  const pending = queueAfterFlush.filter((q) => !q.flushed);
  console.log(`    queue total:      ${queueAfterFlush.length}`);
  console.log(`    pending after:    ${pending.length} (expected 1 — the failure)`);
  console.log(`    succeeded uids:   ${queueAfterFlush.filter((q) => q.attestation_uid).map((q) => q.attestation_uid).join(', ')}`);
  console.log(`    failure error:    ${pending[0]?.flush_error}`);
  if (pending.length !== 1) process.exit(1);

  // 5. Re-flush retries the failure
  console.log('\n[5] re-flush retries the failed entry:');
  const retry = await flushSatelliteAttestations(async () => ({
    uid: '0xretry_uid',
    txHash: '0xretry_tx',
  }));
  console.log(`    attempted=${retry.attempted} succeeded=${retry.succeeded} failed=${retry.failed}`);
  if (retry.attempted !== 1 || retry.succeeded !== 1) process.exit(1);
  if (pendingAttestationCount() !== 0) process.exit(1);

  console.log('\n=== ALL GREEN ===');
}

main().catch((e) => {
  console.error('FAILURE:', e);
  process.exit(1);
});
