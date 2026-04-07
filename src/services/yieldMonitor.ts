/**
 * Yield Monitor Service
 *
 * Fetches live APYs from DeFi Llama, scores protocols by risk-adjusted yield,
 * and provides the data layer for active treasury rebalancing.
 *
 * The agent uses this to know WHERE the best yields are at any given time.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '@elizaos/core';

// ---------------------------------------------------------------------------
// Protocol registry — every protocol Dryad can deposit into
// ---------------------------------------------------------------------------

export interface DeFiProtocol {
  name: string;
  /** DeFi Llama project slug */
  llamaProject: string;
  /** DeFi Llama chain name */
  llamaChain: string;
  /** DeFi Llama symbol filter */
  llamaSymbol: string;
  chain: 'base';
  asset: 'USDC' | 'USDC-DAI' | 'wstETH';
  /** On-chain pool/market address on Base */
  poolAddress: `0x${string}`;
  /** Risk score 0-10 */
  riskScore: number;
  /** Minimum deposit in USD */
  minDeposit: number;
  /** Lock period in days */
  lockDays: number;
  /** Estimated gas cost per deposit/withdraw in USD */
  gasCostPerTx: number;
  /** Last fetched APY (decimal, e.g., 0.045 = 4.5%) */
  currentApy: number;
  /** APY volatility (std dev, estimated) */
  apyVolatility: number;
  /** Last time APY was updated */
  lastUpdated: number;
}

// Base-only protocol registry
export const PROTOCOLS: DeFiProtocol[] = [
  {
    name: 'Aave V3 USDC',
    llamaProject: 'aave-v3',
    llamaChain: 'Base',
    llamaSymbol: 'USDC',
    chain: 'base',
    asset: 'USDC',
    poolAddress: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', // Aave V3 Pool on Base (verified)
    riskScore: 2,
    minDeposit: 5,
    lockDays: 0,
    gasCostPerTx: 0.10,
    currentApy: 0.045,
    apyVolatility: 0.015,
    lastUpdated: 0,
  },
  {
    name: 'Compound V3 USDC',
    llamaProject: 'compound-v3',
    llamaChain: 'Base',
    llamaSymbol: 'USDC',
    chain: 'base',
    asset: 'USDC',
    poolAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F', // Compound V3 cUSDCv3 on Base (verified)
    riskScore: 2,
    minDeposit: 5,
    lockDays: 0,
    gasCostPerTx: 0.10,
    currentApy: 0.042,
    apyVolatility: 0.012,
    lastUpdated: 0,
  },
  // Morpho and Aerodrome removed for POC phase — unverified contract addresses.
  // Re-add once addresses are confirmed on Base mainnet.
];

// ---------------------------------------------------------------------------
// Yield snapshots (persisted)
// ---------------------------------------------------------------------------

export interface YieldSnapshot {
  timestamp: number;
  protocols: Array<{
    name: string;
    apy: number;
    riskAdjustedScore: number;
  }>;
  bestProtocol: string;
  bestApy: number;
}

const SNAPSHOT_PATH = path.join(process.cwd(), 'data', 'yield-snapshots.jsonl');
const MAX_SNAPSHOTS = 365;

function appendYieldSnapshot(snapshot: YieldSnapshot): void {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Read existing, trim, append
    let lines: string[] = [];
    if (fs.existsSync(SNAPSHOT_PATH)) {
      lines = fs.readFileSync(SNAPSHOT_PATH, 'utf-8').trim().split('\n').filter(Boolean);
    }
    lines.push(JSON.stringify(snapshot));
    if (lines.length > MAX_SNAPSHOTS) lines = lines.slice(-MAX_SNAPSHOTS);
    fs.writeFileSync(SNAPSHOT_PATH, lines.join('\n') + '\n');
  } catch (err: any) {
    logger.warn(`[YieldMonitor] Failed to persist snapshot: ${err?.message}`);
  }
}

export function getYieldHistory(days: number = 30): YieldSnapshot[] {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return [];
    const cutoff = Date.now() - days * 86400000;
    return fs.readFileSync(SNAPSHOT_PATH, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as YieldSnapshot)
      .filter(s => s.timestamp > cutoff);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Live APY fetching from DeFi Llama
// ---------------------------------------------------------------------------

/**
 * Fetch live APYs from DeFi Llama and update the protocol registry.
 * Returns the number of protocols successfully updated.
 */
export async function fetchAndUpdateApys(): Promise<{
  updated: number;
  failed: number;
  snapshot: YieldSnapshot;
}> {
  let updated = 0;
  let failed = 0;

  try {
    const resp = await fetch('https://yields.llama.fi/pools', {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`DeFi Llama HTTP ${resp.status}`);

    const data = (await resp.json()) as any;
    const pools: any[] = data?.data || [];

    for (const protocol of PROTOCOLS) {
      try {
        // Find matching pool in DeFi Llama data
        const pool = pools.find(
          (p: any) =>
            p.project === protocol.llamaProject &&
            p.chain === protocol.llamaChain &&
            p.symbol?.includes(protocol.llamaSymbol),
        );

        if (pool && typeof pool.apy === 'number' && pool.apy > 0) {
          const oldApy = protocol.currentApy;
          protocol.currentApy = pool.apy / 100; // percent → decimal
          protocol.lastUpdated = Date.now();
          updated++;

          if (Math.abs(protocol.currentApy - oldApy) > 0.005) {
            logger.info(
              `[YieldMonitor] ${protocol.name}: ${(oldApy * 100).toFixed(2)}% → ${(protocol.currentApy * 100).toFixed(2)}%`,
            );
          }
        } else {
          failed++;
          logger.debug(`[YieldMonitor] No DeFi Llama match for ${protocol.name}`);
        }
      } catch (err: any) {
        failed++;
        logger.warn(`[YieldMonitor] Error matching ${protocol.name}: ${err?.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[YieldMonitor] DeFi Llama fetch failed: ${err?.message}`);
    failed = PROTOCOLS.length;
  }

  // Score and snapshot
  const scored = scoreProtocols();
  const best = scored[0];
  const snapshot: YieldSnapshot = {
    timestamp: Date.now(),
    protocols: scored.map(s => ({
      name: s.protocol.name,
      apy: s.protocol.currentApy,
      riskAdjustedScore: s.riskAdjustedScore,
    })),
    bestProtocol: best?.protocol.name || 'none',
    bestApy: best?.protocol.currentApy || 0,
  };

  appendYieldSnapshot(snapshot);

  logger.info(
    `[YieldMonitor] Updated ${updated}/${PROTOCOLS.length} protocols. Best: ${best?.protocol.name} at ${(best?.protocol.currentApy * 100).toFixed(2)}%`,
  );

  return { updated, failed, snapshot };
}

// ---------------------------------------------------------------------------
// Risk-adjusted scoring
// ---------------------------------------------------------------------------

export interface ScoredProtocol {
  protocol: DeFiProtocol;
  /** Risk-adjusted score (higher = better). Sharpe-like ratio with bonuses. */
  riskAdjustedScore: number;
  /** Conservative APY estimate (APY - 0.5 * volatility) */
  conservativeApy: number;
}

const RISK_FREE_RATE = 0.035; // baseline (wstETH / T-bills)

/**
 * Score all protocols by risk-adjusted yield.
 * Returns protocols sorted best-to-worst.
 */
export function scoreProtocols(): ScoredProtocol[] {
  return PROTOCOLS
    .filter(p => p.lockDays === 0) // Dryad needs liquidity
    .map(protocol => {
      const conservativeApy = Math.max(0, protocol.currentApy - protocol.apyVolatility * 0.5);

      // Sharpe-like: (excess return) / volatility
      const sharpe = protocol.apyVolatility > 0
        ? (conservativeApy - RISK_FREE_RATE) / protocol.apyVolatility
        : 0;

      // Risk penalty: linearly penalize above riskScore 3
      const riskPenalty = Math.max(0, (protocol.riskScore - 3) * 0.15);

      // Gas efficiency bonus: lower gas → bonus
      const gasBonus = protocol.gasCostPerTx <= 0.10 ? 0.05 : 0;

      const riskAdjustedScore = sharpe - riskPenalty + gasBonus;

      return {
        protocol,
        riskAdjustedScore,
        conservativeApy,
      };
    })
    .sort((a, b) => b.riskAdjustedScore - a.riskAdjustedScore);
}

// ---------------------------------------------------------------------------
// Current allocation tracking
// ---------------------------------------------------------------------------

export interface ProtocolPosition {
  protocolName: string;
  depositedUsd: number;
  depositTxHash?: string;
  depositedAt: number;
  /** Running yield earned estimate */
  estimatedYieldUsd: number;
}

const POSITIONS_PATH = path.join(process.cwd(), 'data', 'defi-positions.json');

export function loadPositions(): ProtocolPosition[] {
  try {
    if (fs.existsSync(POSITIONS_PATH)) {
      return JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf-8'));
    }
  } catch { /* start fresh */ }
  return [];
}

export function savePositions(positions: ProtocolPosition[]): void {
  try {
    const dir = path.dirname(POSITIONS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(POSITIONS_PATH, JSON.stringify(positions, null, 2));
  } catch (err: any) {
    logger.error(`[YieldMonitor] Failed to save positions: ${err?.message}`);
  }
}

export function getCurrentAllocation(): Record<string, number> {
  const positions = loadPositions();
  const total = positions.reduce((s, p) => s + p.depositedUsd, 0);
  if (total === 0) return {};

  const alloc: Record<string, number> = {};
  for (const pos of positions) {
    alloc[pos.protocolName] = pos.depositedUsd / total;
  }
  return alloc;
}

/**
 * Get total value currently deposited across all protocols
 */
export function getTotalDeposited(): number {
  return loadPositions().reduce((s, p) => s + p.depositedUsd, 0);
}

// ---------------------------------------------------------------------------
// Optimal allocation calculator
// ---------------------------------------------------------------------------

export interface TargetAllocation {
  protocolName: string;
  targetWeight: number;
  targetUsd: number;
  currentUsd: number;
  deltaUsd: number;
  action: 'deposit' | 'withdraw' | 'hold';
}

/**
 * Calculate optimal allocation for a given deployable amount.
 * Uses risk-adjusted scores to weight allocation, capped by maxExposure.
 */
export function calculateOptimalAllocation(
  deployableUsd: number,
  maxExposure: number = 0.50,
  maxRiskScore: number = 5,
): TargetAllocation[] {
  const scored = scoreProtocols().filter(s => s.protocol.riskScore <= maxRiskScore);
  if (scored.length === 0) return [];

  // Weight by risk-adjusted score (softmax-like)
  const totalScore = scored.reduce((s, p) => s + Math.max(0, p.riskAdjustedScore), 0);
  if (totalScore <= 0) {
    // Fall back to equal weight
    const weight = Math.min(1 / scored.length, maxExposure);
    return scored.map(s => ({
      protocolName: s.protocol.name,
      targetWeight: weight,
      targetUsd: deployableUsd * weight,
      currentUsd: 0,
      deltaUsd: deployableUsd * weight,
      action: 'deposit' as const,
    }));
  }

  // Score-weighted allocation, capped
  let weights = scored.map(s => ({
    name: s.protocol.name,
    rawWeight: Math.max(0, s.riskAdjustedScore) / totalScore,
  }));

  // Cap at maxExposure and redistribute
  let excess = 0;
  let uncapped = 0;
  for (const w of weights) {
    if (w.rawWeight > maxExposure) {
      excess += w.rawWeight - maxExposure;
      w.rawWeight = maxExposure;
    } else {
      uncapped++;
    }
  }
  if (uncapped > 0 && excess > 0) {
    const bonus = excess / uncapped;
    for (const w of weights) {
      if (w.rawWeight < maxExposure) {
        w.rawWeight = Math.min(maxExposure, w.rawWeight + bonus);
      }
    }
  }

  // Normalize
  const totalWeight = weights.reduce((s, w) => s + w.rawWeight, 0);
  weights = weights.map(w => ({ ...w, rawWeight: w.rawWeight / totalWeight }));

  // Compare with current positions
  const positions = loadPositions();
  const posMap = new Map(positions.map(p => [p.protocolName, p.depositedUsd]));

  return weights.map(w => {
    const targetUsd = deployableUsd * w.rawWeight;
    const currentUsd = posMap.get(w.name) || 0;
    const deltaUsd = targetUsd - currentUsd;
    const action: 'deposit' | 'withdraw' | 'hold' =
      deltaUsd > 10 ? 'deposit' :
      deltaUsd < -10 ? 'withdraw' :
      'hold';

    return {
      protocolName: w.name,
      targetWeight: w.rawWeight,
      targetUsd,
      currentUsd,
      deltaUsd,
      action,
    };
  });
}
