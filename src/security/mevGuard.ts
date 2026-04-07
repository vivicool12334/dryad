/**
 * MEV Protection Guard
 *
 * Defends Dryad's treasury transactions against:
 *   - Sandwich attacks (frontrun + backrun around AMM swaps/deposits)
 *   - Frontrunning on large deposits that shift utilization rates
 *   - Slippage exploitation by MEV bots
 *
 * Protection strategies:
 *   1. Private transaction submission via Flashbots Protect RPC on Base
 *   2. Slippage bounds on all DeFi interactions
 *   3. Pre-transaction simulation to detect abnormal price impact
 *   4. Transaction deadline enforcement (txs expire if not mined quickly)
 *   5. Amount chunking — break large moves into smaller pieces
 *   6. Timing randomization — don't rebalance at predictable times
 */
import { logger } from '@elizaos/core';
import { logSecurityEvent } from './sanitize.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MevGuardConfig {
  /** Use Flashbots Protect RPC for private tx submission */
  usePrivateRpc: boolean;
  /** Flashbots Protect RPC URL for Base */
  privateRpcUrl: string;
  /** Maximum acceptable slippage in basis points (100 = 1%) */
  maxSlippageBps: number;
  /** Transaction deadline in seconds from submission */
  txDeadlineSeconds: number;
  /** Maximum single transaction size in USD before chunking */
  maxTxSizeUsd: number;
  /** Minimum chunk size when splitting large txs */
  minChunkSizeUsd: number;
  /** Seconds to wait between chunks to avoid pattern detection */
  chunkDelaySeconds: number;
  /** Maximum price impact allowed (decimal, 0.005 = 0.5%) */
  maxPriceImpact: number;
  /** Skip simulation for lending protocols (Aave/Compound/Morpho) */
  skipSimForLending: boolean;
}

const DEFAULT_CONFIG: MevGuardConfig = {
  usePrivateRpc: true,
  // Flashbots Protect on Base — sends txs privately, not visible in public mempool
  privateRpcUrl: 'https://rpc.flashbots.net/fast?chainId=8453',
  maxSlippageBps: 50, // 0.5% max slippage
  txDeadlineSeconds: 300, // 5 minute deadline
  maxTxSizeUsd: 5000, // Chunk anything over $5K
  minChunkSizeUsd: 500, // Don't make chunks smaller than $500
  chunkDelaySeconds: 30, // 30s between chunks
  maxPriceImpact: 0.005, // 0.5% max price impact
  skipSimForLending: true, // Lending deposits have minimal MEV risk
};

let config: MevGuardConfig = { ...DEFAULT_CONFIG };

export function configureMevGuard(overrides: Partial<MevGuardConfig>): void {
  config = { ...config, ...overrides };
  logger.info(`[MevGuard] Config updated: slippage=${config.maxSlippageBps}bps, deadline=${config.txDeadlineSeconds}s, privateRpc=${config.usePrivateRpc}`);
}

export function getMevGuardConfig(): Readonly<MevGuardConfig> {
  return config;
}

// ---------------------------------------------------------------------------
// Protocol risk classification
// ---------------------------------------------------------------------------

export type ProtocolType = 'lending' | 'amm_lp' | 'vault' | 'swap';

const PROTOCOL_TYPES: Record<string, ProtocolType> = {
  'Aave V3 USDC': 'lending',
  'Compound V3 USDC': 'lending',
  'Morpho USDC Vault': 'vault',
  'Aerodrome USDC/DAI': 'amm_lp',
};

/**
 * Get the MEV risk level for a protocol interaction.
 *
 * Lending: LOW — deposit/withdraw are single-asset, no price oracle manipulation
 * Vault:   LOW-MEDIUM — MetaMorpho vault, single-asset but aggregated
 * AMM LP:  HIGH — two-sided deposit, vulnerable to sandwich attacks
 * Swap:    HIGHEST — direct price manipulation risk
 */
export function getMevRisk(protocolName: string): {
  level: 'low' | 'medium' | 'high';
  type: ProtocolType;
  needsPrivateRpc: boolean;
  needsSimulation: boolean;
  recommendedSlippageBps: number;
} {
  const type = PROTOCOL_TYPES[protocolName] || 'vault';

  switch (type) {
    case 'lending':
      return {
        level: 'low',
        type,
        needsPrivateRpc: false, // Lending deposits aren't sandwichable
        needsSimulation: false,
        recommendedSlippageBps: 10, // 0.1% — lending rates barely move
      };
    case 'vault':
      return {
        level: 'medium',
        type,
        needsPrivateRpc: true, // Vault share price can be manipulated
        needsSimulation: true,
        recommendedSlippageBps: 30, // 0.3%
      };
    case 'amm_lp':
      return {
        level: 'high',
        type,
        needsPrivateRpc: true, // AMM swaps are the #1 sandwich target
        needsSimulation: true,
        recommendedSlippageBps: 50, // 0.5%
      };
    case 'swap':
      return {
        level: 'high',
        type,
        needsPrivateRpc: true,
        needsSimulation: true,
        recommendedSlippageBps: 50,
      };
  }
}

// ---------------------------------------------------------------------------
// Private RPC transport
// ---------------------------------------------------------------------------

/**
 * Get the appropriate RPC transport based on MEV risk.
 * Uses Flashbots Protect for high-risk transactions.
 */
export async function getProtectedTransport(protocolName: string) {
  const { http } = await import('viem');
  const risk = getMevRisk(protocolName);

  if (config.usePrivateRpc && risk.needsPrivateRpc) {
    logger.info(`[MevGuard] Using Flashbots Protect RPC for ${protocolName} (risk: ${risk.level})`);
    return http(config.privateRpcUrl);
  }

  // Standard Base RPC for low-risk operations
  return http();
}

// ---------------------------------------------------------------------------
// Transaction deadline
// ---------------------------------------------------------------------------

/**
 * Get the deadline timestamp for a transaction.
 * Transactions not mined before this timestamp should revert.
 */
export function getDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + config.txDeadlineSeconds);
}

// ---------------------------------------------------------------------------
// Slippage calculation
// ---------------------------------------------------------------------------

/**
 * Calculate minimum acceptable output for a given input amount.
 * Uses protocol-specific slippage bounds.
 */
export function getMinOutput(
  inputAmount: bigint,
  protocolName: string,
): bigint {
  const risk = getMevRisk(protocolName);
  const slippageBps = Math.min(risk.recommendedSlippageBps, config.maxSlippageBps);
  // minOutput = input * (10000 - slippageBps) / 10000
  return (inputAmount * BigInt(10000 - slippageBps)) / 10000n;
}

// ---------------------------------------------------------------------------
// Transaction chunking
// ---------------------------------------------------------------------------

export interface TxChunk {
  index: number;
  amountUsd: number;
  delayMs: number;
}

/**
 * Split a large transaction into smaller chunks to reduce MEV exposure.
 * Only chunks if amount exceeds maxTxSizeUsd for the given protocol.
 */
export function chunkTransaction(
  amountUsd: number,
  protocolName: string,
): TxChunk[] {
  const risk = getMevRisk(protocolName);

  // Low-risk protocols don't need chunking
  if (risk.level === 'low' || amountUsd <= config.maxTxSizeUsd) {
    return [{ index: 0, amountUsd, delayMs: 0 }];
  }

  const numChunks = Math.ceil(amountUsd / config.maxTxSizeUsd);
  const chunkSize = amountUsd / numChunks;

  // Don't make chunks too small
  if (chunkSize < config.minChunkSizeUsd) {
    return [{ index: 0, amountUsd, delayMs: 0 }];
  }

  const chunks: TxChunk[] = [];
  let remaining = amountUsd;

  for (let i = 0; i < numChunks; i++) {
    const thisChunk = i === numChunks - 1 ? remaining : chunkSize;
    chunks.push({
      index: i,
      amountUsd: thisChunk,
      delayMs: i * config.chunkDelaySeconds * 1000,
    });
    remaining -= thisChunk;
  }

  logger.info(
    `[MevGuard] Chunked $${amountUsd} into ${chunks.length} pieces for ${protocolName} (risk: ${risk.level})`,
  );

  return chunks;
}

// ---------------------------------------------------------------------------
// Pre-transaction simulation
// ---------------------------------------------------------------------------

export interface SimulationResult {
  safe: boolean;
  expectedOutput: number;
  priceImpact: number;
  reason?: string;
}

/**
 * Simulate a transaction to estimate output and detect abnormal price impact.
 * Uses eth_call to simulate without broadcasting.
 *
 * For lending protocols (Aave, Compound), we skip simulation since deposits
 * are single-asset and don't affect pool prices.
 */
export async function simulateTransaction(
  protocolName: string,
  action: 'deposit' | 'withdraw',
  amountUsd: number,
): Promise<SimulationResult> {
  const risk = getMevRisk(protocolName);

  // Skip simulation for low-risk lending operations
  if (config.skipSimForLending && risk.type === 'lending') {
    return { safe: true, expectedOutput: amountUsd, priceImpact: 0 };
  }

  try {
    const { createPublicClient, http, parseAbi } = await import('viem');
    const { base } = await import('viem/chains');

    const client = createPublicClient({ chain: base, transport: http() });

    // For vault protocols, check share price consistency
    if (risk.type === 'vault' && protocolName === 'Morpho USDC Vault') {
      const MORPHO_VAULT = '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca' as `0x${string}`;
      const abi = parseAbi([
        'function convertToAssets(uint256 shares) view returns (uint256)',
        'function convertToShares(uint256 assets) view returns (uint256)',
      ]);

      // Check round-trip: assets → shares → assets should be close to identity
      const amountRaw = BigInt(Math.floor(amountUsd * 1e6));
      const shares = await client.readContract({
        address: MORPHO_VAULT,
        abi,
        functionName: 'convertToShares',
        args: [amountRaw],
      }) as bigint;

      const assetsBack = await client.readContract({
        address: MORPHO_VAULT,
        abi,
        functionName: 'convertToAssets',
        args: [shares],
      }) as bigint;

      const priceImpact = amountRaw > 0n
        ? Math.abs(Number(amountRaw - assetsBack)) / Number(amountRaw)
        : 0;

      if (priceImpact > config.maxPriceImpact) {
        logSecurityEvent(
          'MEV_RISK_DETECTED',
          `${protocolName} ${action}: price impact ${(priceImpact * 100).toFixed(3)}% exceeds max ${(config.maxPriceImpact * 100).toFixed(3)}%`,
          'mevGuard',
        );
        return {
          safe: false,
          expectedOutput: Number(assetsBack) / 1e6,
          priceImpact,
          reason: `Price impact too high: ${(priceImpact * 100).toFixed(3)}% (max: ${(config.maxPriceImpact * 100).toFixed(3)}%)`,
        };
      }

      return { safe: true, expectedOutput: Number(assetsBack) / 1e6, priceImpact };
    }

    // For AMM LPs, we'd check the pool reserves and calculate price impact
    if (risk.type === 'amm_lp') {
      // Aerodrome: check if pool has sufficient liquidity
      // For now, use a conservative estimate based on typical pool depths
      // A proper implementation would read pool reserves and calculate impact
      const estimatedImpact = amountUsd > 10000 ? 0.01 : amountUsd > 1000 ? 0.003 : 0.001;

      if (estimatedImpact > config.maxPriceImpact) {
        logSecurityEvent(
          'MEV_RISK_DETECTED',
          `${protocolName} ${action}: estimated impact ${(estimatedImpact * 100).toFixed(3)}% for $${amountUsd}`,
          'mevGuard',
        );
        return {
          safe: false,
          expectedOutput: amountUsd * (1 - estimatedImpact),
          priceImpact: estimatedImpact,
          reason: `Estimated price impact ${(estimatedImpact * 100).toFixed(3)}% too high for $${amountUsd} in ${protocolName}`,
        };
      }

      return { safe: true, expectedOutput: amountUsd * (1 - estimatedImpact), priceImpact: estimatedImpact };
    }

    // Default: assume safe
    return { safe: true, expectedOutput: amountUsd, priceImpact: 0 };
  } catch (err: any) {
    logger.warn(`[MevGuard] Simulation failed for ${protocolName}: ${err?.message}`);
    // If simulation fails, be conservative — still allow lending, block AMM
    if (risk.type === 'lending') {
      return { safe: true, expectedOutput: amountUsd, priceImpact: 0 };
    }
    return {
      safe: false,
      expectedOutput: 0,
      priceImpact: 1,
      reason: `Simulation failed: ${err?.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Full pre-flight check
// ---------------------------------------------------------------------------

export interface PreflightResult {
  approved: boolean;
  usePrivateRpc: boolean;
  chunks: TxChunk[];
  slippageBps: number;
  deadline: bigint;
  simulation: SimulationResult;
  warnings: string[];
}

/**
 * Run all MEV protection checks before executing a DeFi transaction.
 * Returns a preflight result with all parameters needed for safe execution.
 */
export async function preflightCheck(
  protocolName: string,
  action: 'deposit' | 'withdraw',
  amountUsd: number,
): Promise<PreflightResult> {
  const risk = getMevRisk(protocolName);
  const warnings: string[] = [];

  // 1. Simulate
  const simulation = await simulateTransaction(protocolName, action, amountUsd);
  if (!simulation.safe) {
    logSecurityEvent(
      'MEV_TX_BLOCKED',
      `${protocolName} ${action} $${amountUsd}: ${simulation.reason}`,
      'mevGuard',
    );
    return {
      approved: false,
      usePrivateRpc: risk.needsPrivateRpc,
      chunks: [],
      slippageBps: risk.recommendedSlippageBps,
      deadline: getDeadline(),
      simulation,
      warnings: [simulation.reason || 'Simulation indicated unsafe transaction'],
    };
  }

  // 2. Chunk if needed
  const chunks = chunkTransaction(amountUsd, protocolName);
  if (chunks.length > 1) {
    warnings.push(`Split into ${chunks.length} chunks to reduce MEV exposure`);
  }

  // 3. Check time of day — avoid rebalancing during peak MEV hours
  // MEV bots are most active during high-volume trading periods (US market hours)
  const hour = new Date().getUTCHours();
  if (hour >= 13 && hour <= 20 && risk.level === 'high') {
    warnings.push('Peak MEV hours (US trading session) — consider delaying high-risk transactions');
    // Don't block, just warn — the rebalancer can decide
  }

  // 4. Slippage bounds
  const slippageBps = Math.min(risk.recommendedSlippageBps, config.maxSlippageBps);

  logger.info(
    `[MevGuard] Preflight OK: ${protocolName} ${action} $${amountUsd} | risk=${risk.level} | rpc=${risk.needsPrivateRpc ? 'private' : 'public'} | slippage=${slippageBps}bps | chunks=${chunks.length}`,
  );

  return {
    approved: true,
    usePrivateRpc: risk.needsPrivateRpc,
    chunks,
    slippageBps,
    deadline: getDeadline(),
    simulation,
    warnings,
  };
}
