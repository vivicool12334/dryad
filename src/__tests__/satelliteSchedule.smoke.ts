/**
 * Phase-5 smoke test: scheduling helpers + anomaly detection.
 *
 *   npx tsx src/__tests__/satelliteSchedule.smoke.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  shouldRunWeeklyCycle,
  shouldFlushMonthlyAttestations,
  daysSinceLastCycle,
  daysSinceLastAttestationFlush,
  WEEKLY_CYCLE_INTERVAL_DAYS,
  MONTHLY_ATTEST_INTERVAL_DAYS,
  detectAnomalies,
  type ParcelTrendDelta,
  enqueueObservationsForAttestation,
  flushSatelliteAttestations,
  pendingAttestationCount,
  type SatelliteCycle,
} from '../services/satelliteMonitor.ts';

function fakeCycle(id: string, ndvi: number, captureIso: string): SatelliteCycle {
  return {
    cycle_id: id,
    cycle_at: captureIso,
    aoi_bbox: [-83.1007, 42.3411, -83.0994, 42.3424],
    scenes_searched: 1,
    scenes_used: 1,
    observations: [
      {
        parcel_address: '4475 25th St',
        parcel_number: '12009490',
        lat: 42.34143,
        lng: -83.09995,
        ndvi_mean: ndvi,
        ndvi_std: 0.05,
        ndvi_min: ndvi - 0.05,
        ndvi_max: ndvi + 0.05,
        evi_mean: ndvi - 0.02,
        cloud_cover: 10,
        capture_datetime: captureIso,
        scene_id: 'fake-scene',
        satellite: 'Sentinel-2B',
        bbox: [-83.1, 42.34, -83.099, 42.342],
        pixel_count: 12,
        raster_local_path: null,
        preview_local_path: null,
        raster_ipfs_hash: null,
        preview_ipfs_hash: null,
        raster_ipfs_url: null,
        preview_ipfs_url: null,
        error: null,
      },
    ],
    errors: [],
  };
}

async function main(): Promise<void> {
  console.log('=== Phase-5 satellite schedule smoke test ===\n');

  // Reset state — truncate (not unlink, since sandbox forbids unlink)
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  for (const file of ['satellite-history.jsonl', 'satellite-attestation-queue.jsonl']) {
    fs.writeFileSync(path.join(dataDir, file), '');
  }

  // 1. With no history, should run weekly cycle should be true (Infinity > 7)
  console.log('[1] Initial state (no history):');
  console.log(`    daysSinceLastCycle:           ${daysSinceLastCycle()}`);
  console.log(`    shouldRunWeeklyCycle:         ${shouldRunWeeklyCycle()}`);
  console.log(`    shouldFlushMonthly:           ${shouldFlushMonthlyAttestations()}  (false expected — no pending)`);
  if (!shouldRunWeeklyCycle()) {
    console.error('    FAIL: should run weekly when nothing on file');
    process.exit(1);
  }
  if (shouldFlushMonthlyAttestations()) {
    console.error('    FAIL: should not flush monthly when queue is empty');
    process.exit(1);
  }

  // 2. Persist a cycle dated 1 day ago — weekly should NOT run
  console.log('\n[2] After cycle 1 day ago:');
  const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const cycle1 = fakeCycle('sat-1', 0.55, oneDayAgo);
  fs.appendFileSync(
    path.join(dataDir, 'satellite-history.jsonl'),
    JSON.stringify(cycle1) + '\n',
  );
  console.log(`    daysSinceLastCycle:           ${daysSinceLastCycle().toFixed(2)}`);
  console.log(`    shouldRunWeeklyCycle:         ${shouldRunWeeklyCycle()} (false expected)`);
  if (shouldRunWeeklyCycle()) process.exit(1);

  // 3. Persist a cycle dated 8 days ago — weekly SHOULD run
  console.log('\n[3] After cycle 8 days ago:');
  const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
  // Reset the file with just the older cycle
  fs.writeFileSync(
    path.join(dataDir, 'satellite-history.jsonl'),
    JSON.stringify(fakeCycle('sat-old', 0.55, eightDaysAgo)) + '\n',
  );
  console.log(`    daysSinceLastCycle:           ${daysSinceLastCycle().toFixed(2)}`);
  console.log(`    shouldRunWeeklyCycle:         ${shouldRunWeeklyCycle()} (true expected)`);
  if (!shouldRunWeeklyCycle()) process.exit(1);

  // 4. Anomaly detection
  console.log('\n[4] Anomaly detection:');
  const deltas: ParcelTrendDelta[] = [
    {
      parcel_address: '4475 25th St',
      ndvi_now: 0.30,
      ndvi_prev: 0.55,
      ndvi_delta: -0.25, // big drop, should fire
      days_between: 7,
    },
    {
      parcel_address: '4481 25th St',
      ndvi_now: 0.50,
      ndvi_prev: 0.55,
      ndvi_delta: -0.05, // small drop, should not fire
      days_between: 7,
    },
    {
      parcel_address: '4487 25th St',
      ndvi_now: 0.30,
      ndvi_prev: 0.55,
      ndvi_delta: -0.25, // big drop but >7 days, should not fire
      days_between: 14,
    },
    {
      parcel_address: '4493 25th St',
      ndvi_now: 0.60,
      ndvi_prev: 0.55,
      ndvi_delta: 0.05, // increase, should not fire
      days_between: 7,
    },
  ];
  const anomalies = detectAnomalies(deltas);
  console.log(`    anomalies: ${anomalies.length} (expected 1)`);
  for (const a of anomalies) {
    console.log(`      - ${a.parcel_address}: ${a.ndvi_prev.toFixed(2)} -> ${a.ndvi_now.toFixed(2)} (Δ${a.ndvi_delta.toFixed(2)} in ${a.days_between}d)`);
  }
  if (anomalies.length !== 1) process.exit(1);
  if (anomalies[0].parcel_address !== '4475 25th St') process.exit(1);

  // 5. Monthly flush logic
  console.log('\n[5] Monthly flush logic:');
  // Enqueue some observations
  enqueueObservationsForAttestation(cycle1);
  console.log(`    pending after enqueue:        ${pendingAttestationCount()}`);
  console.log(`    daysSinceLastAttestFlush:     ${daysSinceLastAttestationFlush()}  (Infinity expected)`);
  console.log(`    shouldFlushMonthly:           ${shouldFlushMonthlyAttestations()} (true expected — never flushed AND has pending)`);
  if (!shouldFlushMonthlyAttestations()) process.exit(1);

  // Flush them
  let calls = 0;
  await flushSatelliteAttestations(async () => ({ uid: `0xuid_${++calls}`, txHash: `0xtx_${calls}` }));
  console.log(`    after flush, pending:         ${pendingAttestationCount()}`);
  console.log(`    daysSinceLastAttestFlush:     ${daysSinceLastAttestationFlush().toFixed(4)}`);
  console.log(`    shouldFlushMonthly:           ${shouldFlushMonthlyAttestations()} (false expected — just flushed)`);
  if (shouldFlushMonthlyAttestations()) process.exit(1);

  // 6. Constants sanity
  console.log('\n[6] Constants:');
  console.log(`    WEEKLY_CYCLE_INTERVAL_DAYS:   ${WEEKLY_CYCLE_INTERVAL_DAYS}`);
  console.log(`    MONTHLY_ATTEST_INTERVAL_DAYS: ${MONTHLY_ATTEST_INTERVAL_DAYS}`);
  if (WEEKLY_CYCLE_INTERVAL_DAYS !== 7) process.exit(1);
  if (MONTHLY_ATTEST_INTERVAL_DAYS !== 28) process.exit(1);

  console.log('\n=== ALL GREEN ===');
}

main().catch((e) => {
  console.error('FAILURE:', e);
  process.exit(1);
});
