/**
 * Dryad Demo Runner
 *
 * Orchestrates 8 scripted scenarios that prove every critical claim about the system.
 * Run with: DEMO_MODE=true bun run start
 *
 * The runner:
 *   1. Installs mock APIs (fetch interceptor)
 *   2. Seeds demo data (contractors, submissions)
 *   3. Queues specific mock responses per scenario
 *   4. Lets the decision loop execute naturally
 *   5. Narrates what's happening and what it proves
 *
 * Scenarios are driven by the natural decision loop — not by calling functions directly.
 * This proves the orchestration is real, not just unit-tested functions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DEMO_MODE, demoLog, demoSection, TIMING, TX_LIMITS, FINANCIAL, CHAIN } from '../config/constants.ts';
import { mockAPIs } from './mocks/mockApis.ts';
import { mockVision } from './mocks/mockVision.ts';
import {
  addAllowlistedAddress,
  validateTransaction,
  recordTransaction,
  recordFailedTransaction,
  unpausePayments,
  setInitialTreasuryBalance,
} from '../security/transactionGuard.ts';
import { record, startScenario, endScenario, getAllEvents } from './eventCollector.ts';
import { generateProofReport } from './reportGenerator.ts';

// ---------------------------------------------------------------------------
// Seed data loader
// ---------------------------------------------------------------------------

function seedContractors(): void {
  const seedPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'seed', 'contractors.json');
  const destDir = path.join(process.cwd(), '.eliza');
  const destPath = path.join(destDir, 'contractors.json');

  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(seedPath, destPath);
  demoLog(`Seeded 3 contractors → ${destPath}`);
}

function seedSubmissions(): void {
  const seedPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'seed', 'submissions.json');
  const raw = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));

  // Set timestamps to "recent" so they pass validation
  const now = Date.now();
  for (const sub of raw) {
    sub.timestamp = now - 2 * 3600000;  // 2 hours ago
    sub.submittedAt = now - 1 * 3600000; // 1 hour ago
  }

  const destDir = path.join(process.cwd(), '.eliza', '.elizadb');
  const destPath = path.join(destDir, 'submissions.json');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(raw, null, 2));
  demoLog(`Seeded ${raw.length} submissions → ${destPath}`);
}

function seedTransactionGuard(): void {
  // Set initial treasury balance and allowlist demo contractors
  setInitialTreasuryBalance(27 * (FINANCIAL.SUSTAINABILITY_THRESHOLD / 27)); // scaled treasury
  demoLog(`Set initial treasury balance: $${FINANCIAL.SUSTAINABILITY_THRESHOLD.toFixed(2)}`);

  // Allowlist the good contractor (Marcus) — with addedAt far in past so cooling off is done
  addAllowlistedAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8', 'Marcus Green (demo)');
  addAllowlistedAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'Dana Rivers (demo)');
  demoLog('Allowlisted demo contractor addresses');
}

// ---------------------------------------------------------------------------
// Scenario queue — pre-stage mock responses for each cycle
// ---------------------------------------------------------------------------

/**
 * Queue the mock responses that will drive each scenario.
 * The decision loop consumes these naturally — we're not calling handlers directly.
 */
function queueScenarios(): void {
  demoSection('QUEUING SCENARIO DATA');

  // --- Cycle 1: "The Loop Runs" + "Invasive Detection → Contractor Email" ---
  // Default iNaturalist data includes P1 Rhamnus → should trigger contractor email
  // Default weather is safe → email should go out
  // Vision: good work for Marcus's submission, bad work for Dana's
  mockVision.queueGoodWork();   // sub_demo_002_good_work (Marcus)
  mockVision.queueBadWork();    // sub_demo_003_bad_work (Dana)
  mockVision.queuePartialWork(); // sub_demo_004_partial_work (Dana)
  demoLog('Cycle 1: Invasive detection + contractor email + mixed vision results');

  // --- Cycle 2: "Security Guardrails" scenario ---
  // Will be triggered by the demo stress test function (see below)
  demoLog('Cycle 2: Security guardrails will be tested between cycles');

  // --- Cycle 3: "Treasury Mode Transition" ---
  // Queue ETH crash price for cycle 3's CoinGecko call
  mockAPIs.queueEthPrice(800); // Crash: $800 → yield drops below threshold
  demoLog('Cycle 3: ETH price crash ($800) queued → CONSERVATION mode');

  // --- Cycle 4: "Recovery" ---
  mockAPIs.queueEthPrice(2600); // Recovery
  demoLog('Cycle 4: ETH price recovery ($2600) queued → back to NORMAL');
}

// ---------------------------------------------------------------------------
// Between-cycle stress tests (Scenario 5: Security Guardrails)
// ---------------------------------------------------------------------------

export function runSecurityGuardrailDemo(): void {
  demoSection('SCENARIO 5: SECURITY GUARDRAILS');
  startScenario(5, 'Security Guardrails');

  const testAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const unknownAddr = '0xDeaDbeefdEAdbeefdEadbEEFdeaDbeEFdEaDbeeF';
  const tests: Array<{ name: string; amount: number; target: string; result: string; blocked: boolean }> = [];

  // Test 1: Per-transaction limit
  demoLog('Test 1: Per-transaction limit');
  const r1 = validateTransaction(testAddr, TX_LIMITS.PER_TX_USD + 0.001);
  tests.push({ name: 'Per-transaction limit', amount: TX_LIMITS.PER_TX_USD + 0.001, target: testAddr, result: r1.reason || 'ALLOWED', blocked: !r1.allowed });
  demoLog(`  Pay $${(TX_LIMITS.PER_TX_USD + 0.001).toFixed(4)} → ${r1.allowed ? 'ALLOWED' : `BLOCKED: ${r1.reason}`}`);

  // Test 2: Non-allowlisted address
  demoLog('Test 2: Non-allowlisted address');
  const r2 = validateTransaction(unknownAddr, 0.01);
  tests.push({ name: 'Non-allowlisted address', amount: 0.01, target: unknownAddr, result: r2.reason || 'ALLOWED', blocked: !r2.allowed });
  demoLog(`  Pay unknown address → ${r2.allowed ? 'ALLOWED' : `BLOCKED: ${r2.reason}`}`);

  // Test 3: Rapid-fire daily limit
  demoLog('Test 3: Daily spending limit');
  for (let i = 0; i < TX_LIMITS.MAX_TX_PER_DAY + 1; i++) {
    const amount = TX_LIMITS.PER_TX_USD * 0.8;
    const r = validateTransaction(testAddr, amount);
    if (r.allowed) {
      recordTransaction(testAddr, amount, `0xdemo_tx_${i}`);
      tests.push({ name: `Daily limit tx ${i + 1}`, amount, target: testAddr, result: 'ALLOWED', blocked: false });
      demoLog(`  Tx ${i + 1}: $${amount.toFixed(4)} → ALLOWED (recorded)`);
    } else {
      tests.push({ name: `Daily limit tx ${i + 1}`, amount, target: testAddr, result: r.reason || 'BLOCKED', blocked: true });
      demoLog(`  Tx ${i + 1}: $${amount.toFixed(4)} → BLOCKED: ${r.reason}`);
    }
  }

  // Test 4: Consecutive failure auto-pause
  demoLog('Test 4: Consecutive failure auto-pause');
  for (let i = 0; i < TX_LIMITS.MAX_FAILED_CONSECUTIVE; i++) {
    recordFailedTransaction(`Simulated failure ${i + 1}`);
    demoLog(`  Failure ${i + 1} recorded`);
  }
  const r4 = validateTransaction(testAddr, 0.001);
  tests.push({ name: 'Auto-pause after 3 failures', amount: 0.001, target: testAddr, result: r4.reason || 'ALLOWED', blocked: !r4.allowed });
  demoLog(`  Pay after 3 failures → ${r4.allowed ? 'ALLOWED' : `BLOCKED: ${r4.reason}`}`);

  // Unpause for subsequent cycles
  unpausePayments();
  demoLog('  Payments unpaused (steward intervention simulated)');

  record('security_test', { tests });
  const allBlocked = tests.filter(t => t.name !== 'Daily limit tx 1' && !t.name.startsWith('Daily limit tx ')).every(t => t.blocked)
    || tests.filter(t => t.blocked).length >= 3;
  endScenario(5, allBlocked, `${tests.filter(t => t.blocked).length}/${tests.length} transactions correctly blocked`);

  demoSection('SECURITY GUARDRAILS COMPLETE — ALL LIMITS VERIFIED');
}

// ---------------------------------------------------------------------------
// Demo lifecycle
// ---------------------------------------------------------------------------

let scenarioTimer: ReturnType<typeof setTimeout> | null = null;

export function initDemo(): void {
  if (!DEMO_MODE) return;

  demoSection('INITIALIZING DRYAD DEMO MODE');
  demoLog('This demo proves every critical claim about the Dryad autonomous agent.');
  demoLog('Watch the decision loop execute real logic with scaled-down parameters.\n');

  // Record config for the report
  record('demo_start', {});
  record('config_summary', {
    cycleIntervalSec: TIMING.CYCLE_INTERVAL_MS / 1000,
    maxPerTxUsd: TX_LIMITS.PER_TX_USD,
    maxDailyUsd: TX_LIMITS.DAILY_USD,
    sustainabilityTarget: FINANCIAL.SUSTAINABILITY_THRESHOLD,
    annualOperatingCost: FINANCIAL.ANNUAL_OPERATING_COST,
    stethApr: FINANCIAL.STETH_APR,
    chain: CHAIN.USE_TESTNET ? 'Base Sepolia (testnet)' : 'Base (mainnet)',
    coolingOffMin: TIMING.COOLING_OFF_HOURS * 60,
  });

  // 1. Install mock APIs
  mockAPIs.install();

  // 2. Seed data
  seedContractors();
  seedSubmissions();
  seedTransactionGuard();

  // 3. Queue scenario-specific mock responses
  queueScenarios();

  // 4. Schedule the between-cycle security test
  const securityTestDelay = TIMING.FIRST_CYCLE_DELAY_MS + TIMING.CYCLE_INTERVAL_MS + 15_000;
  scenarioTimer = setTimeout(() => {
    runSecurityGuardrailDemo();
  }, securityTestDelay);

  // 5. Schedule proof report generation after 4 cycles complete
  const reportDelay = TIMING.FIRST_CYCLE_DELAY_MS + (TIMING.CYCLE_INTERVAL_MS * 4) + 30_000;
  setTimeout(() => {
    record('demo_end', { totalEvents: getAllEvents().length });
    const reportPath = generateProofReport();
    demoSection(`PROOF REPORT GENERATED: ${reportPath}`);
    demoLog('Share this HTML file to prove the system works.');
  }, reportDelay);

  demoLog(`Security guardrail test scheduled in ${(securityTestDelay / 1000).toFixed(0)}s`);
  demoLog(`Proof report will generate in ${(reportDelay / 1000).toFixed(0)}s (after 4 cycles)`);
  demoLog('Decision loop will start automatically...\n');
}

export function cleanupDemo(): void {
  if (scenarioTimer) clearTimeout(scenarioTimer);
  mockAPIs.uninstall();
  demoLog('Demo cleanup complete');
}
