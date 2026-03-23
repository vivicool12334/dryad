/**
 * Financial transaction safety layer.
 * Wraps all outgoing payments with allowlist, velocity, and anomaly checks.
 * State is persisted to disk so it survives restarts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logSecurityEvent } from './sanitize.ts';

// ─── Persistence ───
const STATE_PATH = path.join(process.cwd(), 'data', 'transaction-guard-state.json');

interface PersistedState {
  allowlist: Record<string, { addedAt: number; label: string }>;
  txHistory: Array<{ timestamp: number; amount: number; recipient: string; txHash?: string }>;
  paymentsPaused: boolean;
  consecutiveFailures: number;
  initialTreasuryBalance: number | null;
}

function loadState(): PersistedState {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      // Validate structure
      if (parsed && typeof parsed === 'object' && parsed.allowlist && Array.isArray(parsed.txHistory)) {
        return parsed as PersistedState;
      }
    }
  } catch {
    logSecurityEvent('STATE_LOAD_FAILED', 'Could not load transaction guard state — using defaults', 'transactionGuard');
  }
  return {
    allowlist: {},
    txHistory: [],
    paymentsPaused: false,
    consecutiveFailures: 0,
    initialTreasuryBalance: null,
  };
}

function saveState(): void {
  try {
    const state: PersistedState = {
      allowlist: Object.fromEntries(
        Array.from(allowlistedRecipients.entries()).map(([k, v]) => [k, { addedAt: v.addedAt, label: v.label }])
      ),
      txHistory,
      paymentsPaused,
      consecutiveFailures,
      initialTreasuryBalance,
    };
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Best effort — in-memory state is always authoritative
  }
}

// ─── Load persisted state ───
const loaded = loadState();

const allowlistedRecipients = new Map<string, { addedAt: number; label: string; coolingOff: boolean }>();
// Restore allowlist — addresses that were added > COOLING_OFF_HOURS ago are active
for (const [addr, info] of Object.entries(loaded.allowlist)) {
  const coolingOff = (Date.now() - info.addedAt) < LIMITS_COOLING_OFF_MS();
  allowlistedRecipients.set(addr, { ...info, coolingOff });
}

const txHistory: Array<{ timestamp: number; amount: number; recipient: string; txHash?: string }> = loaded.txHistory;
// Trim stale entries on load
const loadCutoff = Date.now() - 30 * 86400000;
while (txHistory.length > 0 && txHistory[0].timestamp < loadCutoff) txHistory.shift();

let consecutiveFailures = loaded.consecutiveFailures;
let paymentsPaused = loaded.paymentsPaused;
let initialTreasuryBalance: number | null = loaded.initialTreasuryBalance;

if (allowlistedRecipients.size > 0) {
  logSecurityEvent('STATE_RESTORED', `Loaded ${allowlistedRecipients.size} allowlisted addresses, ${txHistory.length} tx history entries, paused=${paymentsPaused}`, 'transactionGuard');
}

// ─── Constants ───
const LIMITS = {
  PER_TX_USD: 50,
  DAILY_USD: 200,
  MAX_TX_PER_DAY: 3,
  MAX_TX_PER_CONTRACTOR_PER_DAY: 1,
  COOLING_OFF_HOURS: 24,
  QUIET_HOURS_START: 23,
  QUIET_HOURS_END: 6,
  TREASURY_FLOOR_PERCENT: 0.80,
  MAX_FAILED_CONSECUTIVE: 3,
};

function LIMITS_COOLING_OFF_MS() { return LIMITS.COOLING_OFF_HOURS * 3600000; }

// ─── Public API ───

export function setInitialTreasuryBalance(balanceUsd: number): void {
  if (initialTreasuryBalance === null) {
    initialTreasuryBalance = balanceUsd;
    saveState();
  }
}

export function addAllowlistedAddress(address: string, label: string): { success: boolean; reason?: string } {
  const n = address.toLowerCase();
  if (allowlistedRecipients.has(n)) return { success: false, reason: 'Already allowlisted' };

  allowlistedRecipients.set(n, { addedAt: Date.now(), label, coolingOff: true });
  logSecurityEvent('ADDRESS_ADDED', `${label} (${address}) — 24hr cooling off`, 'transactionGuard');
  saveState();

  setTimeout(() => {
    const entry = allowlistedRecipients.get(n);
    if (entry) {
      entry.coolingOff = false;
      logSecurityEvent('ADDRESS_ACTIVE', `${label} (${address}) now active`, 'transactionGuard');
      saveState();
    }
  }, LIMITS.COOLING_OFF_HOURS * 3600000);

  return { success: true };
}

export function isAddressAllowlisted(address: string): boolean {
  const entry = allowlistedRecipients.get(address.toLowerCase());
  return !!entry && !entry.coolingOff;
}

export function validateTransaction(
  recipient: string,
  amountUsd: number,
  currentTreasuryUsd?: number
): { allowed: boolean; reason?: string } {
  const n = recipient.toLowerCase();

  if (paymentsPaused) {
    return { allowed: false, reason: 'Payments paused due to consecutive failures. Steward intervention required.' };
  }

  if (amountUsd > LIMITS.PER_TX_USD) {
    logSecurityEvent('TX_REJECTED', `$${amountUsd} > $${LIMITS.PER_TX_USD} limit`, 'transactionGuard');
    return { allowed: false, reason: `Amount $${amountUsd} exceeds $${LIMITS.PER_TX_USD} per-tx limit` };
  }

  // Allowlist check — ALWAYS enforced. Empty allowlist = deny all.
  if (!allowlistedRecipients.has(n)) {
    logSecurityEvent('TX_REJECTED', `${recipient} not allowlisted (${allowlistedRecipients.size} addresses on list)`, 'transactionGuard');
    return { allowed: false, reason: `Recipient not allowlisted. Add address first (24hr cooling-off required).` };
  }
  const entry = allowlistedRecipients.get(n)!;
  if (entry.coolingOff) {
    const hrs = Math.ceil((entry.addedAt + LIMITS.COOLING_OFF_HOURS * 3600000 - Date.now()) / 3600000);
    return { allowed: false, reason: `${entry.label} in cooling-off (${hrs}h remaining)` };
  }

  // Quiet hours
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', hour12: false }));
  if (hour >= LIMITS.QUIET_HOURS_START || hour < LIMITS.QUIET_HOURS_END) {
    logSecurityEvent('TX_REJECTED', `Quiet hours (${hour}:00 ET)`, 'transactionGuard');
    return { allowed: false, reason: `Blocked during quiet hours (11pm-6am ET)` };
  }

  // Daily limits
  const dayAgo = Date.now() - 86400000;
  const recent = txHistory.filter(tx => tx.timestamp > dayAgo);
  const dailyTotal = recent.reduce((s, tx) => s + tx.amount, 0);

  if (dailyTotal + amountUsd > LIMITS.DAILY_USD) {
    return { allowed: false, reason: `Daily limit: $${dailyTotal.toFixed(0)}/$${LIMITS.DAILY_USD} spent` };
  }
  if (recent.length >= LIMITS.MAX_TX_PER_DAY) {
    return { allowed: false, reason: `Max ${LIMITS.MAX_TX_PER_DAY} tx/day reached` };
  }

  const contractorToday = recent.filter(tx => tx.recipient === n);
  if (contractorToday.length >= LIMITS.MAX_TX_PER_CONTRACTOR_PER_DAY) {
    return { allowed: false, reason: 'Already paid this contractor today' };
  }

  // Treasury floor
  if (currentTreasuryUsd !== undefined && initialTreasuryBalance !== null) {
    const floor = initialTreasuryBalance * LIMITS.TREASURY_FLOOR_PERCENT;
    if (currentTreasuryUsd < floor) {
      logSecurityEvent('TREASURY_CRITICAL', `$${currentTreasuryUsd} < floor $${floor}`, 'transactionGuard');
      return { allowed: false, reason: `Treasury below ${LIMITS.TREASURY_FLOOR_PERCENT * 100}% floor` };
    }
  }

  return { allowed: true };
}

export function recordTransaction(recipient: string, amountUsd: number, txHash?: string): void {
  txHistory.push({ timestamp: Date.now(), amount: amountUsd, recipient: recipient.toLowerCase(), txHash });
  consecutiveFailures = 0;
  // Trim to 30 days
  const cutoff = Date.now() - 30 * 86400000;
  while (txHistory.length > 0 && txHistory[0].timestamp < cutoff) txHistory.shift();
  saveState();
}

export function recordFailedTransaction(reason: string): void {
  consecutiveFailures++;
  logSecurityEvent('TX_FAILED', `#${consecutiveFailures}: ${reason}`, 'transactionGuard');
  if (consecutiveFailures >= LIMITS.MAX_FAILED_CONSECUTIVE) {
    paymentsPaused = true;
    logSecurityEvent('PAYMENTS_PAUSED', `${LIMITS.MAX_FAILED_CONSECUTIVE} failures — paused`, 'transactionGuard');
  }
  saveState();
}

export function unpausePayments(): void {
  paymentsPaused = false;
  consecutiveFailures = 0;
  logSecurityEvent('PAYMENTS_RESUMED', 'Manual resume', 'transactionGuard');
  saveState();
}

export function isPaymentsPaused(): boolean { return paymentsPaused; }
export function getTransactionHistory() { return [...txHistory]; }
