/**
 * Treasury Rebalancer
 *
 * The decision-making layer for active yield management.
 * Evaluates current vs optimal allocation and executes rebalances
 * when the expected benefit exceeds costs.
 *
 * Design principles:
 *   - Conservative: only rebalance when clearly beneficial
 *   - Gas-aware: expected improvement must exceed 3x gas cost
 *   - Gradual: never move more than 30% of treasury in one cycle
 *   - Auditable: every decision is logged with reasoning
 *   - Liquid: always maintain a cash reserve for operations
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@elizaos/core';
import { audit } from './auditLog.ts';
import {
  fetchAndUpdateApys,
  calculateOptimalAllocation,
  loadPositions,
  getTotalDeposited,
  getYieldHistory,
  type TargetAllocation,
  PROTOCOLS,
} from './yieldMonitor.ts';
import {
  depositToProtocol,
  withdrawFromProtocol,
  getUsdcBalance,
} from '../actions/defiYield.ts';
import { getMevRisk } from '../security/mevGuard.ts';
import { REBALANCER as REBALANCER_CONFIG } from '../config/constants.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RebalancerConfig {
  /** Minimum days between rebalances */
  minRebalanceIntervalDays: number;
  /** Minimum expected APY improvement to trigger rebalance (decimal) */
  minApyImprovementThreshold: number;
  /** Expected improvement must exceed gas cost by this multiple */
  gasCostMultiplier: number;
  /** Maximum fraction of total treasury to move in one rebalance */
  maxMovePercent: number;
  /** Cash reserve to keep as idle USDC (not deployed to protocols) */
  cashReserveUsd: number;
  /** Maximum single-protocol exposure */
  maxExposure: number;
  /** Maximum risk score to consider */
  maxRiskScore: number;
  /** Minimum number of APY data points before trusting a protocol */
  minDataPoints: number;
}

const DEFAULT_CONFIG: RebalancerConfig = {
  minRebalanceIntervalDays: REBALANCER_CONFIG.MIN_REBALANCE_INTERVAL_DAYS,
  minApyImprovementThreshold: REBALANCER_CONFIG.MIN_APY_IMPROVEMENT_THRESHOLD,
  gasCostMultiplier: REBALANCER_CONFIG.GAS_COST_MULTIPLIER,
  maxMovePercent: REBALANCER_CONFIG.MAX_MOVE_PERCENT,
  cashReserveUsd: REBALANCER_CONFIG.CASH_RESERVE_USD,
  maxExposure: REBALANCER_CONFIG.MAX_EXPOSURE,
  maxRiskScore: REBALANCER_CONFIG.MAX_RISK_SCORE,
  minDataPoints: REBALANCER_CONFIG.MIN_DATA_POINTS,
};

// ---------------------------------------------------------------------------
// Rebalance state (persisted)
// ---------------------------------------------------------------------------

interface RebalanceRecord {
  timestamp: number;
  actions: Array<{
    protocol: string;
    action: 'deposit' | 'withdraw';
    amountUsd: number;
    txHash?: string;
    success: boolean;
  }>;
  reasoning: string;
  beforeAllocation: Record<string, number>;
  afterAllocation: Record<string, number>;
  estimatedApyBefore: number;
  estimatedApyAfter: number;
}

const REBALANCE_HISTORY_PATH = path.join(process.cwd(), 'data', 'rebalance-history.json');

function loadRebalanceHistory(): RebalanceRecord[] {
  try {
    if (fs.existsSync(REBALANCE_HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(REBALANCE_HISTORY_PATH, 'utf-8'));
    }
  } catch { /* start fresh */ }
  return [];
}

function saveRebalanceRecord(record: RebalanceRecord): void {
  try {
    const history = loadRebalanceHistory();
    history.push(record);
    // Keep last 100 records
    const trimmed = history.slice(-100);
    const dir = path.dirname(REBALANCE_HISTORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REBALANCE_HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  } catch (err: any) {
    logger.error(`[Rebalancer] Failed to save history: ${err?.message}`);
  }
}

function getLastRebalanceTime(): number {
  const history = loadRebalanceHistory();
  if (history.length === 0) return 0;
  return history[history.length - 1].timestamp;
}

// ---------------------------------------------------------------------------
// Portfolio APY estimation
// ---------------------------------------------------------------------------

function estimatePortfolioApy(): number {
  const positions = loadPositions();
  const total = positions.reduce((s, p) => s + p.depositedUsd, 0);
  if (total === 0) return 0;

  let weightedApy = 0;
  for (const pos of positions) {
    const protocol = PROTOCOLS.find(p => p.name === pos.protocolName);
    if (protocol) {
      weightedApy += (pos.depositedUsd / total) * protocol.currentApy;
    }
  }
  return weightedApy;
}

function estimateTargetApy(targets: TargetAllocation[]): number {
  let weightedApy = 0;
  for (const target of targets) {
    const protocol = PROTOCOLS.find(p => p.name === target.protocolName);
    if (protocol) {
      weightedApy += target.targetWeight * protocol.currentApy;
    }
  }
  return weightedApy;
}

// ---------------------------------------------------------------------------
// Core rebalancing logic
// ---------------------------------------------------------------------------

export interface RebalanceEvaluation {
  shouldRebalance: boolean;
  reason: string;
  targets: TargetAllocation[];
  currentApy: number;
  targetApy: number;
  apyImprovement: number;
  estimatedGasCost: number;
  estimatedAnnualBenefit: number;
  daysSinceLastRebalance: number;
}

/**
 * Evaluate whether a rebalance should happen.
 * Does NOT execute anything — just returns the analysis.
 */
export async function evaluateRebalance(
  config: RebalancerConfig = DEFAULT_CONFIG,
): Promise<RebalanceEvaluation> {
  // 1. Check time constraint
  const lastRebalance = getLastRebalanceTime();
  const daysSince = (Date.now() - lastRebalance) / 86400000;

  if (daysSince < config.minRebalanceIntervalDays && lastRebalance > 0) {
    return {
      shouldRebalance: false,
      reason: `Too soon — ${daysSince.toFixed(1)} days since last rebalance (min: ${config.minRebalanceIntervalDays})`,
      targets: [],
      currentApy: estimatePortfolioApy(),
      targetApy: 0,
      apyImprovement: 0,
      estimatedGasCost: 0,
      estimatedAnnualBenefit: 0,
      daysSinceLastRebalance: daysSince,
    };
  }

  // 2. Fetch fresh APYs
  await fetchAndUpdateApys();

  // 3. Check we have enough data
  const yieldHistory = getYieldHistory(30);
  if (yieldHistory.length < config.minDataPoints) {
    return {
      shouldRebalance: false,
      reason: `Insufficient data — ${yieldHistory.length} snapshots (need ${config.minDataPoints})`,
      targets: [],
      currentApy: estimatePortfolioApy(),
      targetApy: 0,
      apyImprovement: 0,
      estimatedGasCost: 0,
      estimatedAnnualBenefit: 0,
      daysSinceLastRebalance: daysSince,
    };
  }

  // 4. Calculate deployable amount
  const idleUsdc = await getUsdcBalance();
  const totalDeposited = getTotalDeposited();
  const totalAvailable = idleUsdc + totalDeposited;
  const deployable = Math.max(0, totalAvailable - config.cashReserveUsd);

  if (deployable < 50) {
    return {
      shouldRebalance: false,
      reason: `Insufficient deployable funds: $${deployable.toFixed(0)} (need > $50 after $${config.cashReserveUsd} reserve)`,
      targets: [],
      currentApy: estimatePortfolioApy(),
      targetApy: 0,
      apyImprovement: 0,
      estimatedGasCost: 0,
      estimatedAnnualBenefit: 0,
      daysSinceLastRebalance: daysSince,
    };
  }

  // 5. Calculate optimal allocation
  const targets = calculateOptimalAllocation(deployable, config.maxExposure, config.maxRiskScore);
  const currentApy = estimatePortfolioApy();
  const targetApy = estimateTargetApy(targets);
  const apyImprovement = targetApy - currentApy;

  // 6. Estimate costs and benefits (including MEV risk premium)
  const movingTargets = targets.filter(t => t.action !== 'hold');
  const estimatedGasCost = movingTargets.reduce((sum, t) => {
    const protocol = PROTOCOLS.find(p => p.name === t.protocolName);
    const basGas = protocol?.gasCostPerTx || 0.15;

    // Add MEV risk premium — high-risk protocols (AMM LPs) get a slippage buffer
    const mevRisk = getMevRisk(t.protocolName);
    const mevPremium = mevRisk.level === 'high'
      ? Math.abs(t.deltaUsd) * 0.005 // 0.5% sandwich risk premium on AMMs
      : mevRisk.level === 'medium'
        ? Math.abs(t.deltaUsd) * 0.002 // 0.2% on vaults
        : 0; // lending is safe

    return sum + basGas + mevPremium;
  }, 0);

  // Annual benefit = improvement * deployable
  const estimatedAnnualBenefit = apyImprovement * deployable;

  // 7. Decision logic
  let shouldRebalance = false;
  let reason = '';

  if (totalDeposited === 0 && idleUsdc > config.cashReserveUsd + 50) {
    // First deployment — always do it
    shouldRebalance = true;
    reason = `Initial deployment: $${deployable.toFixed(0)} USDC idle, deploying to yield protocols`;
  } else if (apyImprovement < config.minApyImprovementThreshold) {
    reason = `APY improvement too small: ${(apyImprovement * 100).toFixed(2)}% (need ${(config.minApyImprovementThreshold * 100).toFixed(2)}%)`;
  } else if (estimatedAnnualBenefit < estimatedGasCost * config.gasCostMultiplier) {
    reason = `Not cost-effective: annual benefit $${estimatedAnnualBenefit.toFixed(2)} < ${config.gasCostMultiplier}x gas cost $${(estimatedGasCost * config.gasCostMultiplier).toFixed(2)}`;
  } else {
    shouldRebalance = true;
    reason = `Rebalance beneficial: +${(apyImprovement * 100).toFixed(2)}% APY, $${estimatedAnnualBenefit.toFixed(0)}/yr benefit vs $${estimatedGasCost.toFixed(2)} gas`;
  }

  return {
    shouldRebalance,
    reason,
    targets,
    currentApy,
    targetApy,
    apyImprovement,
    estimatedGasCost,
    estimatedAnnualBenefit,
    daysSinceLastRebalance: daysSince,
  };
}

/**
 * Execute a rebalance based on the evaluation.
 * Performs withdrawals first, then deposits.
 * Respects maxMovePercent to limit how much moves in one cycle.
 */
export async function executeRebalance(
  evaluation: RebalanceEvaluation,
  config: RebalancerConfig = DEFAULT_CONFIG,
): Promise<RebalanceRecord> {
  const { targets } = evaluation;
  const totalDeposited = getTotalDeposited();
  const idleUsdc = await getUsdcBalance();
  const totalValue = totalDeposited + idleUsdc;
  const maxMove = totalValue * config.maxMovePercent;

  // Capture before state
  const beforeAllocation: Record<string, number> = {};
  const positions = loadPositions();
  for (const pos of positions) {
    beforeAllocation[pos.protocolName] = pos.depositedUsd;
  }
  beforeAllocation['idle_usdc'] = idleUsdc;

  const actions: RebalanceRecord['actions'] = [];
  let totalMoved = 0;

  // Phase 1: Withdrawals (free up capital)
  const withdrawals = targets.filter(t => t.action === 'withdraw');
  for (const target of withdrawals) {
    const moveAmount = Math.min(Math.abs(target.deltaUsd), maxMove - totalMoved);
    if (moveAmount < 5 || totalMoved >= maxMove) continue;

    logger.info(`[Rebalancer] Withdrawing $${moveAmount.toFixed(0)} from ${target.protocolName}`);
    const result = await withdrawFromProtocol(target.protocolName, moveAmount);
    actions.push({
      protocol: target.protocolName,
      action: 'withdraw',
      amountUsd: moveAmount,
      txHash: result.txHash,
      success: result.success,
    });
    if (result.success) totalMoved += moveAmount;
  }

  // Phase 2: Deposits (deploy capital)
  const deposits = targets.filter(t => t.action === 'deposit');
  const availableUsdc = await getUsdcBalance();
  let deployed = 0;

  for (const target of deposits) {
    const remaining = availableUsdc - config.cashReserveUsd - deployed;
    if (remaining < 10) break;

    const moveAmount = Math.min(
      Math.abs(target.deltaUsd),
      remaining,
      maxMove - totalMoved,
    );
    if (moveAmount < 10 || totalMoved >= maxMove) continue;

    // Check protocol minimum
    const protocol = PROTOCOLS.find(p => p.name === target.protocolName);
    if (protocol && moveAmount < protocol.minDeposit) continue;

    logger.info(`[Rebalancer] Depositing $${moveAmount.toFixed(0)} into ${target.protocolName}`);
    const result = await depositToProtocol(target.protocolName, moveAmount);
    actions.push({
      protocol: target.protocolName,
      action: 'deposit',
      amountUsd: moveAmount,
      txHash: result.txHash,
      success: result.success,
    });
    if (result.success) {
      totalMoved += moveAmount;
      deployed += moveAmount;
    }
  }

  // Capture after state
  const afterAllocation: Record<string, number> = {};
  const newPositions = loadPositions();
  for (const pos of newPositions) {
    afterAllocation[pos.protocolName] = pos.depositedUsd;
  }
  afterAllocation['idle_usdc'] = await getUsdcBalance();

  const record: RebalanceRecord = {
    timestamp: Date.now(),
    actions,
    reasoning: evaluation.reason,
    beforeAllocation,
    afterAllocation,
    estimatedApyBefore: evaluation.currentApy,
    estimatedApyAfter: evaluation.targetApy,
  };

  saveRebalanceRecord(record);

  const successCount = actions.filter(a => a.success).length;
  const failCount = actions.filter(a => !a.success).length;

  audit(
    'REBALANCE_EXECUTED',
    `${successCount} success, ${failCount} failed, $${totalMoved.toFixed(0)} moved. APY: ${(evaluation.currentApy * 100).toFixed(2)}% → ${(evaluation.targetApy * 100).toFixed(2)}%`,
    'rebalancer',
    failCount > 0 ? 'warn' : 'info',
  );

  logger.info(
    `[Rebalancer] Rebalance complete: ${successCount}/${actions.length} actions succeeded, $${totalMoved.toFixed(0)} moved`,
  );

  return record;
}

// ---------------------------------------------------------------------------
// One-call rebalance check (for the decision loop)
// ---------------------------------------------------------------------------

/**
 * Full rebalance cycle: evaluate → execute if beneficial.
 * Returns a human-readable summary for the decision loop log.
 */
export async function runRebalanceCheck(
  config: RebalancerConfig = DEFAULT_CONFIG,
): Promise<string> {
  try {
    const evaluation = await evaluateRebalance(config);

    if (!evaluation.shouldRebalance) {
      logger.info(`[Rebalancer] No rebalance needed: ${evaluation.reason}`);
      return `no_rebalance: ${evaluation.reason} | current APY: ${(evaluation.currentApy * 100).toFixed(2)}%`;
    }

    logger.info(`[Rebalancer] Rebalance triggered: ${evaluation.reason}`);
    const record = await executeRebalance(evaluation, config);

    const successCount = record.actions.filter(a => a.success).length;
    return `rebalanced: ${successCount} actions, APY ${(record.estimatedApyBefore * 100).toFixed(2)}% → ${(record.estimatedApyAfter * 100).toFixed(2)}%`;
  } catch (err: any) {
    logger.error(`[Rebalancer] Rebalance check failed: ${err?.message}`);
    audit('REBALANCE_ERROR', err?.message || 'Unknown error', 'rebalancer', 'critical');
    return `error: ${err?.message}`;
  }
}

// ---------------------------------------------------------------------------
// Public getters for API/UI
// ---------------------------------------------------------------------------

export function getRebalanceHistory(): RebalanceRecord[] {
  return loadRebalanceHistory();
}

export function getRebalancerStatus(): {
  lastRebalance: number;
  daysSinceRebalance: number;
  currentApy: number;
  totalDeposited: number;
  positionCount: number;
} {
  const lastRebalance = getLastRebalanceTime();
  return {
    lastRebalance,
    daysSinceRebalance: lastRebalance > 0 ? (Date.now() - lastRebalance) / 86400000 : Infinity,
    currentApy: estimatePortfolioApy(),
    totalDeposited: getTotalDeposited(),
    positionCount: loadPositions().length,
  };
}
