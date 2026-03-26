/**
 * Persistent treasury snapshots — one per decision loop cycle.
 * Appends to data/treasury-snapshots.jsonl for trend charting.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface TreasurySnapshot {
  timestamp: number;
  wstEthBalance: string;   // decimal string, e.g. "1.234567"
  ethBalance: string;
  ethPriceUsd: number;
  estimatedUsd: number;    // (wstEth + eth) * ethPrice
  annualYieldUsd: number;  // wstEth * ethPrice * 0.035
  dailyYieldUsd: number;
  spendingMode: 'NORMAL' | 'CONSERVATION' | 'CRITICAL';
  dailySpendUsd: number;   // from transactionGuard history
  diemBalance: string;
}

const LOG_PATH = path.join(process.cwd(), 'data', 'treasury-snapshots.jsonl');
const memoryBuffer: TreasurySnapshot[] = [];
const MAX_BUFFER = 365; // one year at daily snapshots

export function appendTreasurySnapshot(snap: TreasurySnapshot): void {
  memoryBuffer.push(snap);
  if (memoryBuffer.length > MAX_BUFFER) memoryBuffer.shift();

  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(snap) + '\n');
  } catch {
    // in-memory fallback
  }
}

export function getTreasuryHistory(days: number = 30): TreasurySnapshot[] {
  const cutoff = Date.now() - days * 86400000;
  try {
    if (fs.existsSync(LOG_PATH)) {
      const raw = fs.readFileSync(LOG_PATH, 'utf-8').trim();
      if (!raw) return [];
      const all = raw.split('\n').filter(Boolean).map(l => JSON.parse(l) as TreasurySnapshot);
      return all.filter(s => s.timestamp >= cutoff).reverse();
    }
  } catch {
    // fall through
  }
  return [...memoryBuffer].filter(s => s.timestamp >= cutoff).reverse();
}

export function getLatestTreasurySnapshot(): TreasurySnapshot | null {
  const history = getTreasuryHistory(365);
  return history[0] ?? null;
}
