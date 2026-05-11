/**
 * Phase-3 smoke test (manual run, requires the Python microservice to be running locally).
 *
 *   1. Start the microservice: cd services/satellite-microservice && python3 -m uvicorn main:app --port 9006
 *   2. Run this file: npx tsx src/__tests__/satelliteMonitor.smoke.ts
 *
 * Exits 0 on success, 1 on failure. Verifies the full TS → HTTP → microservice → MPC round trip.
 */
import {
  probeSatelliteService,
  fetchSatelliteCycle,
  computeTrendDeltas,
  detectAnomalies,
  persistSatelliteCycle,
  loadSatelliteHistory,
} from '../services/satelliteMonitor.ts';
import { summarizeCycle } from '../actions/checkSatelliteImagery.ts';

async function main(): Promise<void> {
  console.log('=== Phase-3 satellite smoke test ===\n');

  // 1. Probe
  console.log('[1] probeSatelliteService...');
  const probe = await probeSatelliteService();
  console.log(`    reachable:        ${probe.reachable}`);
  console.log(`    status:           ${probe.status}`);
  console.log(`    ipfs configured:  ${probe.ipfsConfigured}`);
  if (!probe.reachable) {
    console.error(`    ERROR: ${probe.error}`);
    process.exit(1);
  }

  // 2. Pull a cycle
  console.log('\n[2] fetchSatelliteCycle (window 30d, cloud 30%, no IPFS)...');
  const cycle = await fetchSatelliteCycle({
    windowDays: 30,
    cloudCoverMax: 30,
    pinToIpfs: false,
  });
  console.log(`    cycle_id:         ${cycle.cycle_id}`);
  console.log(`    scenes_searched:  ${cycle.scenes_searched}`);
  console.log(`    scenes_used:      ${cycle.scenes_used}`);
  console.log(`    observations:     ${cycle.observations.length}`);
  console.log(`    errors:           ${cycle.errors.length}`);

  if (cycle.observations.length === 0) {
    console.error('    ERROR: zero observations');
    process.exit(1);
  }

  const validObs = cycle.observations.filter((o) => !o.error);
  if (validObs.length === 0) {
    console.error('    ERROR: zero valid observations');
    process.exit(1);
  }

  // 3. Trend deltas (will be empty on first run, populated on subsequent runs)
  console.log('\n[3] computeTrendDeltas...');
  const deltas = computeTrendDeltas(cycle);
  console.log(`    delta entries:    ${deltas.length}`);
  console.log(`    with baseline:    ${deltas.filter((d) => d.ndvi_delta != null).length}`);

  // 4. Anomalies
  console.log('\n[4] detectAnomalies...');
  const anomalies = detectAnomalies(deltas);
  console.log(`    anomalies:        ${anomalies.length}`);

  // 5. Persist
  console.log('\n[5] persistSatelliteCycle...');
  persistSatelliteCycle(cycle);
  const history = loadSatelliteHistory();
  console.log(`    cycles in history: ${history.length}`);

  // 6. Summarize
  console.log('\n[6] summarizeCycle (action chat output):\n');
  console.log(summarizeCycle(cycle, deltas, anomalies).split('\n').map((l) => '    ' + l).join('\n'));

  console.log('\n=== ALL GREEN ===');
}

main().catch((e) => {
  console.error('FAILURE:', e);
  process.exit(1);
});
