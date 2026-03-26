/**
 * Persistent history for the autonomous decision loop.
 * Appends one entry per 24-hour cycle to data/loop-history.jsonl.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface LoopStep {
  name: string;
  result: string;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
}

export interface LoopHistoryEntry {
  timestamp: number;      // Unix ms
  status: 'success' | 'failure';
  durationMs: number;
  season: string;
  actionsTriggered: string[];
  errorsEncountered: string[];
  steps: LoopStep[];
}

const LOG_PATH = path.join(process.cwd(), 'data', 'loop-history.jsonl');
const memoryBuffer: LoopHistoryEntry[] = [];
const MAX_BUFFER = 100;

export function appendLoopEntry(entry: LoopHistoryEntry): void {
  memoryBuffer.push(entry);
  if (memoryBuffer.length > MAX_BUFFER) memoryBuffer.shift();

  try {
    const dir = path.dirname(LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // in-memory buffer is fallback
  }
}

export function getLoopHistory(limit: number = 30): LoopHistoryEntry[] {
  try {
    if (fs.existsSync(LOG_PATH)) {
      const raw = fs.readFileSync(LOG_PATH, 'utf-8').trim();
      if (!raw) return [];
      const entries = raw.split('\n').filter(Boolean).map(l => JSON.parse(l) as LoopHistoryEntry);
      return entries.slice(-limit).reverse();
    }
  } catch {
    // fall through to memory
  }
  return [...memoryBuffer].slice(-limit).reverse();
}

export function getLatestLoop(): LoopHistoryEntry | null {
  const history = getLoopHistory(1);
  return history[0] ?? null;
}

export function getLoopStats(days: number = 30): {
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  avgDurationMs: number;
  lastRunAt: number | null;
} {
  const cutoff = Date.now() - days * 86400000;
  const all = getLoopHistory(days * 2).filter(e => e.timestamp >= cutoff);
  const successes = all.filter(e => e.status === 'success');
  const avgDurationMs = all.length > 0
    ? Math.round(all.reduce((s, e) => s + e.durationMs, 0) / all.length)
    : 0;
  return {
    totalRuns: all.length,
    successRuns: successes.length,
    failureRuns: all.length - successes.length,
    avgDurationMs,
    lastRunAt: all.length > 0 ? all[0].timestamp : null,
  };
}
