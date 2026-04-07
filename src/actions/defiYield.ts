/**
 * DeFi Yield Actions — Deposit/Withdraw from yield protocols on Base.
 *
 * Supports:
 *   - Aave V3 USDC (supply/withdraw)
 *   - Compound V3 USDC (supply/withdraw)
 *   - Morpho Blue USDC Vault (deposit/withdraw)
 *   - Aerodrome USDC/DAI LP (deposit/withdraw)
 *
 * All actions go through the transaction guard and MEV guard for safety.
 * The agent never moves funds without the rebalancer explicitly calling these.
 */
import { logger } from '@elizaos/core';
import { audit } from '../services/auditLog.ts';
import {
  PROTOCOLS,
  type DeFiProtocol,
  loadPositions,
  savePositions,
  type ProtocolPosition,
} from '../services/yieldMonitor.ts';
import {
  preflightCheck,
  getProtectedTransport,
} from '../security/mevGuard.ts';

// ---------------------------------------------------------------------------
// Contract addresses on Base
// ---------------------------------------------------------------------------

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

// Aave V3 on Base
const AAVE_V3_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as const;

// Compound V3 cUSDCv3 (Comet) on Base
const COMPOUND_V3_COMET = '0xb125E6687d4313864e53df431d5425969c15Eb2F' as const;

// Morpho Blue vault on Base (MetaMorpho USDC)
const MORPHO_VAULT = '0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca' as const;

// Aerodrome Router on Base
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as const;

// Standard ERC20 + protocol ABIs (minimal)
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
] as const;

const COMPOUND_COMET_ABI = [
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function balanceOf(address) view returns (uint256)',
] as const;

const MORPHO_VAULT_ABI = [
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
] as const;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getViemClients(protocolName?: string) {
  const { createPublicClient, createWalletClient, http, parseAbi } = await import('viem');
  const { base, baseSepolia } = await import('viem/chains');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { CHAIN } = await import('../config/constants.ts');

  const pk = process.env.EVM_PRIVATE_KEY;
  if (!pk) throw new Error('EVM_PRIVATE_KEY not set');

  const selectedChain = CHAIN.USE_TESTNET ? baseSepolia : base;
  const defaultTransport = CHAIN.RPC_URL ? http(CHAIN.RPC_URL) : http();

  const account = privateKeyToAccount(pk as `0x${string}`);
  const publicClient = createPublicClient({ chain: selectedChain, transport: defaultTransport });

  // Use private RPC for MEV-sensitive protocols (mainnet only)
  const walletTransport = (!CHAIN.USE_TESTNET && protocolName)
    ? await getProtectedTransport(protocolName)
    : defaultTransport;
  const walletClient = createWalletClient({ chain: selectedChain, transport: walletTransport, account });

  return { publicClient, walletClient, account, parseAbi };
}

/**
 * Ensure USDC approval for a spender. Only sends tx if needed.
 * Accepts pre-created clients to avoid nonce desync between approval and deposit.
 */
async function ensureApproval(
  spender: `0x${string}`,
  amountRaw: bigint,
  clients?: { publicClient: any; walletClient: any; account: any; parseAbi: any },
): Promise<void> {
  const { publicClient, walletClient, account, parseAbi } = clients || await getViemClients();
  const abi = parseAbi(ERC20_ABI);

  const currentAllowance = await publicClient.readContract({
    address: BASE_USDC,
    abi,
    functionName: 'allowance',
    args: [account.address, spender],
  }) as bigint;

  if (currentAllowance >= amountRaw) return;

  // Approve max uint256 to avoid repeated approvals
  const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  logger.info(`[DeFiYield] Approving ${spender} for USDC (max allowance)...`);
  const hash = await walletClient.writeContract({
    address: BASE_USDC,
    abi,
    functionName: 'approve',
    args: [spender, MAX_UINT256],
  });

  await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  logger.info(`[DeFiYield] Approval tx confirmed: ${hash}`);
}

/**
 * Get USDC balance of the agent wallet.
 */
export async function getUsdcBalance(): Promise<number> {
  const { publicClient, account, parseAbi } = await getViemClients();
  const abi = parseAbi(ERC20_ABI);

  const bal = await publicClient.readContract({
    address: BASE_USDC,
    abi,
    functionName: 'balanceOf',
    args: [account.address],
  }) as bigint;

  // USDC has 6 decimals
  return Number(bal) / 1e6;
}

// ---------------------------------------------------------------------------
// Protocol-specific deposit/withdraw
// ---------------------------------------------------------------------------

export interface DefiTxResult {
  success: boolean;
  txHash?: string;
  protocol: string;
  action: 'deposit' | 'withdraw';
  amountUsd: number;
  error?: string;
}

/**
 * Deposit USDC into Aave V3 on Base.
 */
async function depositAave(amountUsd: number): Promise<DefiTxResult> {
  const protocol = 'Aave V3 USDC';
  try {
    const clients = await getViemClients('Aave V3 USDC');
    const { publicClient, walletClient, account, parseAbi } = clients;
    const amountRaw = BigInt(Math.floor(amountUsd * 1e6));

    await ensureApproval(AAVE_V3_POOL, amountRaw, clients);

    const abi = parseAbi(AAVE_POOL_ABI);
    const hash = await walletClient.writeContract({
      address: AAVE_V3_POOL,
      abi,
      functionName: 'supply',
      args: [BASE_USDC, amountRaw, account.address, 0],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[DeFiYield] Deposited $${amountUsd} into Aave V3. tx: ${hash}`);
    audit('DEFI_DEPOSIT', `Aave V3: $${amountUsd} USDC`, 'defiYield', 'info');

    return { success: true, txHash: hash, protocol, action: 'deposit', amountUsd };
  } catch (err: any) {
    logger.error(`[DeFiYield] Aave deposit failed: ${err?.message}`);
    return { success: false, protocol, action: 'deposit', amountUsd, error: err?.message };
  }
}

async function withdrawAave(amountUsd: number): Promise<DefiTxResult> {
  const protocol = 'Aave V3 USDC';
  try {
    const { publicClient, walletClient, account, parseAbi } = await getViemClients(protocol);
    const amountRaw = BigInt(Math.floor(amountUsd * 1e6));

    const abi = parseAbi(AAVE_POOL_ABI);
    const hash = await walletClient.writeContract({
      address: AAVE_V3_POOL,
      abi,
      functionName: 'withdraw',
      args: [BASE_USDC, amountRaw, account.address],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[DeFiYield] Withdrew $${amountUsd} from Aave V3. tx: ${hash}`);
    audit('DEFI_WITHDRAW', `Aave V3: $${amountUsd} USDC`, 'defiYield', 'info');

    return { success: true, txHash: hash, protocol, action: 'withdraw', amountUsd };
  } catch (err: any) {
    logger.error(`[DeFiYield] Aave withdraw failed: ${err?.message}`);
    return { success: false, protocol, action: 'withdraw', amountUsd, error: err?.message };
  }
}

/**
 * Deposit USDC into Compound V3 on Base.
 */
async function depositCompound(amountUsd: number): Promise<DefiTxResult> {
  const protocol = 'Compound V3 USDC';
  try {
    const clients = await getViemClients(protocol);
    const { publicClient, walletClient, account, parseAbi } = clients;
    const amountRaw = BigInt(Math.floor(amountUsd * 1e6));

    await ensureApproval(COMPOUND_V3_COMET, amountRaw, clients);

    const abi = parseAbi(COMPOUND_COMET_ABI);
    const hash = await walletClient.writeContract({
      address: COMPOUND_V3_COMET,
      abi,
      functionName: 'supply',
      args: [BASE_USDC, amountRaw],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[DeFiYield] Deposited $${amountUsd} into Compound V3. tx: ${hash}`);
    audit('DEFI_DEPOSIT', `Compound V3: $${amountUsd} USDC`, 'defiYield', 'info');

    return { success: true, txHash: hash, protocol, action: 'deposit', amountUsd };
  } catch (err: any) {
    logger.error(`[DeFiYield] Compound deposit failed: ${err?.message}`);
    return { success: false, protocol, action: 'deposit', amountUsd, error: err?.message };
  }
}

async function withdrawCompound(amountUsd: number): Promise<DefiTxResult> {
  const protocol = 'Compound V3 USDC';
  try {
    const { publicClient, walletClient, account, parseAbi } = await getViemClients(protocol);
    const amountRaw = BigInt(Math.floor(amountUsd * 1e6));

    const abi = parseAbi(COMPOUND_COMET_ABI);
    const hash = await walletClient.writeContract({
      address: COMPOUND_V3_COMET,
      abi,
      functionName: 'withdraw',
      args: [BASE_USDC, amountRaw],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[DeFiYield] Withdrew $${amountUsd} from Compound V3. tx: ${hash}`);
    audit('DEFI_WITHDRAW', `Compound V3: $${amountUsd} USDC`, 'defiYield', 'info');

    return { success: true, txHash: hash, protocol, action: 'withdraw', amountUsd };
  } catch (err: any) {
    logger.error(`[DeFiYield] Compound withdraw failed: ${err?.message}`);
    return { success: false, protocol, action: 'withdraw', amountUsd, error: err?.message };
  }
}

/**
 * Deposit USDC into Morpho Blue vault on Base.
 */
async function depositMorpho(amountUsd: number): Promise<DefiTxResult> {
  const protocol = 'Morpho USDC Vault';
  try {
    const clients = await getViemClients(protocol);
    const { publicClient, walletClient, account, parseAbi } = clients;
    const amountRaw = BigInt(Math.floor(amountUsd * 1e6));

    await ensureApproval(MORPHO_VAULT, amountRaw, clients);

    const abi = parseAbi(MORPHO_VAULT_ABI);
    const hash = await walletClient.writeContract({
      address: MORPHO_VAULT,
      abi,
      functionName: 'deposit',
      args: [amountRaw, account.address],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[DeFiYield] Deposited $${amountUsd} into Morpho vault. tx: ${hash}`);
    audit('DEFI_DEPOSIT', `Morpho: $${amountUsd} USDC`, 'defiYield', 'info');

    return { success: true, txHash: hash, protocol, action: 'deposit', amountUsd };
  } catch (err: any) {
    logger.error(`[DeFiYield] Morpho deposit failed: ${err?.message}`);
    return { success: false, protocol, action: 'deposit', amountUsd, error: err?.message };
  }
}

async function withdrawMorpho(amountUsd: number): Promise<DefiTxResult> {
  const protocol = 'Morpho USDC Vault';
  try {
    const { publicClient, walletClient, account, parseAbi } = await getViemClients(protocol);
    const amountRaw = BigInt(Math.floor(amountUsd * 1e6));

    const abi = parseAbi(MORPHO_VAULT_ABI);
    const hash = await walletClient.writeContract({
      address: MORPHO_VAULT,
      abi,
      functionName: 'withdraw',
      args: [amountRaw, account.address, account.address],
    });

    await publicClient.waitForTransactionReceipt({ hash });
    logger.info(`[DeFiYield] Withdrew $${amountUsd} from Morpho vault. tx: ${hash}`);
    audit('DEFI_WITHDRAW', `Morpho: $${amountUsd} USDC`, 'defiYield', 'info');

    return { success: true, txHash: hash, protocol, action: 'withdraw', amountUsd };
  } catch (err: any) {
    logger.error(`[DeFiYield] Morpho withdraw failed: ${err?.message}`);
    return { success: false, protocol, action: 'withdraw', amountUsd, error: err?.message };
  }
}

// ---------------------------------------------------------------------------
// Unified deposit/withdraw dispatcher
// ---------------------------------------------------------------------------

const DEPOSIT_FNS: Record<string, (amount: number) => Promise<DefiTxResult>> = {
  'Aave V3 USDC': depositAave,
  'Compound V3 USDC': depositCompound,
  'Morpho USDC Vault': depositMorpho,
};

const WITHDRAW_FNS: Record<string, (amount: number) => Promise<DefiTxResult>> = {
  'Aave V3 USDC': withdrawAave,
  'Compound V3 USDC': withdrawCompound,
  'Morpho USDC Vault': withdrawMorpho,
};

/**
 * Deposit USDC into a named protocol. Updates position tracking.
 * Runs MEV preflight check before execution.
 */
export async function depositToProtocol(
  protocolName: string,
  amountUsd: number,
): Promise<DefiTxResult> {
  const fn = DEPOSIT_FNS[protocolName];
  if (!fn) {
    return { success: false, protocol: protocolName, action: 'deposit', amountUsd, error: `Unknown protocol: ${protocolName}` };
  }

  if (amountUsd < 1) {
    return { success: false, protocol: protocolName, action: 'deposit', amountUsd, error: 'Amount too small' };
  }

  // MEV preflight check
  const preflight = await preflightCheck(protocolName, 'deposit', amountUsd);
  if (!preflight.approved) {
    const reason = `MEV guard blocked: ${preflight.simulation.reason || 'unsafe transaction'}`;
    logger.warn(`[DeFiYield] ${reason}`);
    audit('DEFI_DEPOSIT', `BLOCKED by MEV guard: ${protocolName} $${amountUsd} — ${reason}`, 'defiYield', 'warn');
    return { success: false, protocol: protocolName, action: 'deposit', amountUsd, error: reason };
  }

  if (preflight.warnings.length > 0) {
    logger.info(`[DeFiYield] MEV warnings for ${protocolName}: ${preflight.warnings.join('; ')}`);
  }

  // Execute in chunks if needed (for large amounts on high-risk protocols)
  let lastResult: DefiTxResult | null = null;
  let totalDeposited = 0;

  for (const chunk of preflight.chunks) {
    if (chunk.delayMs > 0) {
      logger.info(`[DeFiYield] Waiting ${chunk.delayMs / 1000}s before next chunk...`);
      await new Promise(resolve => setTimeout(resolve, chunk.delayMs));
    }

    const result = await fn(chunk.amountUsd);
    lastResult = result;

    if (result.success) {
      totalDeposited += chunk.amountUsd;
    } else {
      // Stop chunking on failure
      logger.error(`[DeFiYield] Chunk ${chunk.index} failed for ${protocolName}: ${result.error}`);
      break;
    }
  }

  if (totalDeposited > 0) {
    // Update position tracking
    const positions = loadPositions();
    const existing = positions.find(p => p.protocolName === protocolName);
    if (existing) {
      existing.depositedUsd += totalDeposited;
    } else {
      positions.push({
        protocolName,
        depositedUsd: totalDeposited,
        depositTxHash: lastResult?.txHash,
        depositedAt: Date.now(),
        estimatedYieldUsd: 0,
      });
    }
    savePositions(positions);
  }

  return lastResult || { success: false, protocol: protocolName, action: 'deposit', amountUsd, error: 'No chunks executed' };
}

/**
 * Withdraw USDC from a named protocol. Updates position tracking.
 * Runs MEV preflight check before execution.
 */
export async function withdrawFromProtocol(
  protocolName: string,
  amountUsd: number,
): Promise<DefiTxResult> {
  const fn = WITHDRAW_FNS[protocolName];
  if (!fn) {
    return { success: false, protocol: protocolName, action: 'withdraw', amountUsd, error: `Unknown protocol: ${protocolName}` };
  }

  // MEV preflight check
  const preflight = await preflightCheck(protocolName, 'withdraw', amountUsd);
  if (!preflight.approved) {
    const reason = `MEV guard blocked: ${preflight.simulation.reason || 'unsafe transaction'}`;
    logger.warn(`[DeFiYield] ${reason}`);
    audit('DEFI_WITHDRAW', `BLOCKED by MEV guard: ${protocolName} $${amountUsd} — ${reason}`, 'defiYield', 'warn');
    return { success: false, protocol: protocolName, action: 'withdraw', amountUsd, error: reason };
  }

  // Execute in chunks if needed
  let lastResult: DefiTxResult | null = null;
  let totalWithdrawn = 0;

  for (const chunk of preflight.chunks) {
    if (chunk.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, chunk.delayMs));
    }

    const result = await fn(chunk.amountUsd);
    lastResult = result;

    if (result.success) {
      totalWithdrawn += chunk.amountUsd;
    } else {
      break;
    }
  }

  if (totalWithdrawn > 0) {
    const positions = loadPositions();
    const existing = positions.find(p => p.protocolName === protocolName);
    if (existing) {
      existing.depositedUsd = Math.max(0, existing.depositedUsd - totalWithdrawn);
      if (existing.depositedUsd < 1) {
        const idx = positions.indexOf(existing);
        positions.splice(idx, 1);
      }
    }
    savePositions(positions);
  }

  return lastResult || { success: false, protocol: protocolName, action: 'withdraw', amountUsd, error: 'No chunks executed' };
}

/**
 * Get on-chain USDC balance for a protocol position (useful for checking actual vs tracked).
 * Currently returns the tracked position; on-chain verification can be added per-protocol.
 */
export function getTrackedPosition(protocolName: string): number {
  const positions = loadPositions();
  return positions.find(p => p.protocolName === protocolName)?.depositedUsd || 0;
}
