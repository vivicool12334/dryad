/**
 * Persistent treasury snapshots - one per decision loop cycle.
 * Appends to data/treasury-snapshots.jsonl for trend charting.
 */
import * as path from 'path';
import { getErrorMessage, isFileNotFoundError } from '../utils/fileErrors.ts';
import { appendJsonlRecord, readJsonlRecords } from '../utils/jsonlLog.ts';

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
  appendJsonlRecord(LOG_PATH, memoryBuffer, snap, MAX_BUFFER, (error) => {
    console.warn(`[treasurySnapshots] Failed to persist treasury snapshot, using memory buffer: ${getErrorMessage(error)}`);
  });
}

export function getTreasuryHistory(days: number = 30): TreasurySnapshot[] {
  const cutoff = Date.now() - days * 86400000;
  const history = readJsonlRecords<TreasurySnapshot>(LOG_PATH, (error) => {
    if (!isFileNotFoundError(error)) {
      console.warn(`[treasurySnapshots] Failed to read treasury snapshots, using memory buffer: ${getErrorMessage(error)}`);
    }
  });
  if (history) return history.filter((snapshot) => snapshot.timestamp >= cutoff).reverse();
  return [...memoryBuffer].filter(s => s.timestamp >= cutoff).reverse();
}

export function getLatestTreasurySnapshot(): TreasurySnapshot | null {
  const history = getTreasuryHistory(365);
  return history[0] ?? null;
}
