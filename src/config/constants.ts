/**
 * Centralized configuration for Dryad.
 *
 * DEMO_MODE=true scales everything down ~1000x so the full autonomous cycle
 * completes in minutes instead of days, using pennies instead of dollars.
 *
 * Production values are the defaults. Demo values override them when
 * process.env.DEMO_MODE === 'true'.
 */

export const DEMO_MODE = process.env.DEMO_MODE === 'true';

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const TIMING = {
  /** Decision loop interval */
  CYCLE_INTERVAL_MS: DEMO_MODE
    ? 2 * 60 * 1000           // 2 minutes
    : 24 * 60 * 60 * 1000,    // 24 hours

  /** Delay before first cycle after boot */
  FIRST_CYCLE_DELAY_MS: DEMO_MODE
    ? 10_000                   // 10 seconds
    : 30_000,                  // 30 seconds

  /** Weather cache lifetime */
  WEATHER_CACHE_MS: DEMO_MODE
    ? 5 * 60 * 1000            // 5 minutes
    : 24 * 60 * 60 * 1000,    // 24 hours

  /** Minimum days between rebalances */
  MIN_REBALANCE_INTERVAL_DAYS: DEMO_MODE ? 0.01 : 0.04,  // ~15 min demo, ~1 hour prod (POC phase)

  /** Photo submission max age */
  MAX_SUBMISSION_AGE_HOURS: DEMO_MODE ? 720 : 72,  // Relaxed for demo seeding

  /** Cooling-off period for new allowlisted addresses */
  COOLING_OFF_HOURS: DEMO_MODE ? 0.03 : 24,  // ~2 min vs 24 hours

  /** How often weekly reports fire — in demo, every Nth cycle */
  WEEKLY_REPORT_EVERY_N_CYCLES: DEMO_MODE ? 5 : null,  // null = real Monday schedule

  /** Tweet on every cycle in demo, Mon/Thu in production */
  TWEET_EVERY_CYCLE: DEMO_MODE,
} as const;

// ---------------------------------------------------------------------------
// Financial model
// ---------------------------------------------------------------------------

const SCALE = DEMO_MODE ? 0.001 : 1;  // 1000x reduction

export const FINANCIAL = {
  /** Year 3+ annual operating cost */
  ANNUAL_OPERATING_COST: 945 * SCALE,

  /** Years 1-2 establishment cost */
  ANNUAL_COST_ESTABLISHMENT: 1445 * SCALE,

  /** Annual cost if land value tax passes */
  ANNUAL_COST_WITH_LVT: 1278 * SCALE,

  /** stETH APR (percentage stays the same — it's a rate, not a dollar amount) */
  STETH_APR: 0.035,

  /** Treasury balance needed for self-sustainability: operating_cost / APR */
  get SUSTAINABILITY_THRESHOLD() {
    return this.ANNUAL_OPERATING_COST / this.STETH_APR;
  },

  /** Non-negotiable annual expenses: taxes + VPS + gas + LLC */
  NON_NEGOTIABLE_ANNUAL: 383 * SCALE,

  /** DIEM: Max ETH per swap */
  MAX_SWAP_ETH: DEMO_MODE ? '0.00001' : '0.01',

  /** DIEM: Low credit warning threshold (daily credits) */
  DIEM_LOW_CREDIT_THRESHOLD: DEMO_MODE ? 0.0001 : 0.1,
} as const;

// ---------------------------------------------------------------------------
// Transaction guard limits
// ---------------------------------------------------------------------------

export const TX_LIMITS = {
  /** Maximum USD per single transaction */
  PER_TX_USD: 50 * SCALE,

  /** Maximum USD spend per day */
  DAILY_USD: 200 * SCALE,

  /** Maximum transactions per day */
  MAX_TX_PER_DAY: DEMO_MODE ? 10 : 3,  // More headroom in demo

  /** Maximum transactions per contractor per day */
  MAX_TX_PER_CONTRACTOR_PER_DAY: DEMO_MODE ? 3 : 1,

  /** Quiet hours start (24h format, Detroit time). Disabled in demo. */
  QUIET_HOURS_START: DEMO_MODE ? -1 : 23,  // -1 = disabled

  /** Quiet hours end */
  QUIET_HOURS_END: DEMO_MODE ? -1 : 6,

  /** Treasury floor: block payments if balance drops below this fraction of initial */
  TREASURY_FLOOR_PERCENT: 0.80,

  /** Auto-pause payments after this many consecutive failures */
  MAX_FAILED_CONSECUTIVE: 3,

  /** How long to retain transaction history */
  HISTORY_RETENTION_DAYS: DEMO_MODE ? 1 : 30,
} as const;

// ---------------------------------------------------------------------------
// Rebalancer
// ---------------------------------------------------------------------------

export const REBALANCER = {
  MIN_REBALANCE_INTERVAL_DAYS: TIMING.MIN_REBALANCE_INTERVAL_DAYS,
  MIN_APY_IMPROVEMENT_THRESHOLD: DEMO_MODE ? 0.001 : 0.005,
  GAS_COST_MULTIPLIER: 3,
  MAX_MOVE_PERCENT: 0.30,
  CASH_RESERVE_USD: DEMO_MODE ? 0.50 : 10,  // $10 reserve (POC phase — raise to $500 when treasury > $5K)
  MAX_EXPOSURE: 0.60,  // Allow 60% in one protocol (only 2 protocols active)
  MAX_RISK_SCORE: 5,
  MIN_DATA_POINTS: 1,  // Deploy on first APY fetch (POC phase — raise to 7 for production)
} as const;

// ---------------------------------------------------------------------------
// Protocol min deposits (scaled)
// ---------------------------------------------------------------------------

export const PROTOCOL_OVERRIDES = DEMO_MODE ? {
  'Aave V3 USDC': { minDeposit: 0.01 },
  'Compound V3 USDC': { minDeposit: 0.01 },
} : null;

// ---------------------------------------------------------------------------
// Chain configuration
// ---------------------------------------------------------------------------

export const CHAIN = {
  /** Use Base Sepolia testnet in demo mode */
  USE_TESTNET: DEMO_MODE,

  /** Chain ID */
  CHAIN_ID: DEMO_MODE ? 84532 : 8453,

  /** Contract addresses — testnet overrides come from env vars */
  USDC_ADDRESS: (DEMO_MODE
    ? process.env.DEMO_USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e'  // USDC on Base Sepolia
    : process.env.USDC_BASE_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  ) as `0x${string}`,

  WSTETH_ADDRESS: (DEMO_MODE
    ? process.env.DEMO_WSTETH_ADDRESS || '0x0000000000000000000000000000000000000000'  // Placeholder — mock in demo
    : process.env.STETH_BASE_ADDRESS || '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452'
  ) as `0x${string}`,

  DIEM_ADDRESS: (DEMO_MODE
    ? process.env.DEMO_DIEM_ADDRESS || '0x0000000000000000000000000000000000000000'
    : process.env.DIEM_TOKEN_ADDRESS || '0xf4d97f2da56e8c3098f3a8d538db630a2606a024'
  ) as `0x${string}`,

  MILESTONES_ADDRESS: (DEMO_MODE
    ? process.env.DEMO_MILESTONES_ADDRESS || '0x0000000000000000000000000000000000000000'
    : process.env.MILESTONES_CONTRACT_ADDRESS || '0x7572dcac88720470d8cc827be5b02d474951bc22'
  ) as `0x${string}`,

  /** RPC URL */
  RPC_URL: DEMO_MODE
    ? process.env.DEMO_RPC_URL || 'https://sepolia.base.org'
    : process.env.BASE_RPC_URL || undefined,  // undefined = viem default
} as const;

// ---------------------------------------------------------------------------
// Buffer sizes (smaller in demo for snappy display)
// ---------------------------------------------------------------------------

export const BUFFERS = {
  MAX_AUDIT_ENTRIES: DEMO_MODE ? 50 : 500,
  MAX_LOOP_HISTORY: DEMO_MODE ? 20 : 100,
  MAX_TREASURY_SNAPSHOTS: DEMO_MODE ? 50 : 365,
  MAX_HEALTH_SNAPSHOTS: DEMO_MODE ? 50 : 365,
  MAX_YIELD_SNAPSHOTS: DEMO_MODE ? 50 : 365,
  MAX_REBALANCE_HISTORY: DEMO_MODE ? 20 : 100,
} as const;

// ---------------------------------------------------------------------------
// Submission validation
// ---------------------------------------------------------------------------

export const SUBMISSIONS = {
  MAX_AGE_HOURS: TIMING.MAX_SUBMISSION_AGE_HOURS,
  /** Max distance from parcel in meters — relaxed in demo */
  MAX_PARCEL_DISTANCE_METERS: DEMO_MODE ? 500 : 50,
} as const;

// ---------------------------------------------------------------------------
// Contractor payment
// ---------------------------------------------------------------------------

export const CONTRACTOR = {
  MAX_PER_TX_USD: TX_LIMITS.PER_TX_USD,
  MAX_DAILY_USD: TX_LIMITS.DAILY_USD,
  /** First job cap for new contractors */
  FIRST_JOB_CAP_USD: 100 * SCALE,
  /** Minimum reliability score to be selected for jobs */
  MIN_RELIABILITY_SCORE: DEMO_MODE ? 40 : 70,
} as const;

// ---------------------------------------------------------------------------
// Demo narration helpers
// ---------------------------------------------------------------------------

export function demoLog(message: string): void {
  if (DEMO_MODE) {
    const ts = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Detroit' });
    console.log(`\n🎬 [DEMO ${ts}] ${message}`);
  }
}

export function demoSection(title: string): void {
  if (DEMO_MODE) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎬 DEMO: ${title}`);
    console.log(`${'═'.repeat(60)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Summary (logged on boot)
// ---------------------------------------------------------------------------

export function logConfig(): void {
  if (!DEMO_MODE) return;

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    🌿 DRYAD DEMO MODE 🌿                    ║
╠══════════════════════════════════════════════════════════════╣
║  Decision loop:        every ${(TIMING.CYCLE_INTERVAL_MS / 1000).toFixed(0)}s (prod: 24h)             ║
║  First cycle in:       ${(TIMING.FIRST_CYCLE_DELAY_MS / 1000).toFixed(0)}s                            ║
║  Treasury target:      $${FINANCIAL.SUSTAINABILITY_THRESHOLD.toFixed(2)} (prod: $27,000)       ║
║  Max per-tx:           $${TX_LIMITS.PER_TX_USD.toFixed(3)} (prod: $50)              ║
║  Max daily spend:      $${TX_LIMITS.DAILY_USD.toFixed(3)} (prod: $200)             ║
║  Cooling-off:          ${(TIMING.COOLING_OFF_HOURS * 60).toFixed(0)} min (prod: 24h)             ║
║  Rebalance interval:   ${(REBALANCER.MIN_REBALANCE_INTERVAL_DAYS * 24 * 60).toFixed(0)} min (prod: 14 days)       ║
║  Chain:                ${CHAIN.USE_TESTNET ? 'Base Sepolia (testnet)' : 'Base (mainnet)'}        ║
║  Quiet hours:          ${TX_LIMITS.QUIET_HOURS_START === -1 ? 'DISABLED' : `${TX_LIMITS.QUIET_HOURS_START}:00-${TX_LIMITS.QUIET_HOURS_END}:00 ET`}                       ║
╚══════════════════════════════════════════════════════════════╝
`);
}
