/**
 * Persistent history for the autonomous decision loop.
 * Appends one entry per 24-hour cycle to data/loop-history.jsonl.
 */
import * as path from "path";
import { getErrorMessage, isFileNotFoundError } from "../utils/fileErrors.ts";
import { appendJsonlRecord, readJsonlRecords } from "../utils/jsonlLog.ts";

export interface LoopStep {
  name: string;
  result: string;
  durationMs: number;
  status: "ok" | "error" | "skipped";
}

export interface LoopHistoryEntry {
  timestamp: number; // Unix ms
  status: "success" | "failure";
  durationMs: number;
  season: string;
  actionsTriggered: string[];
  errorsEncountered: string[];
  steps: LoopStep[];
}

export interface LoopStats {
  totalRuns: number;
  successRuns: number;
  failureRuns: number;
  avgDurationMs: number;
  lastRunAt: number | null;
}

const LOG_PATH = path.join(process.cwd(), "data", "loop-history.jsonl");
const memoryBuffer: LoopHistoryEntry[] = [];
const MAX_BUFFER = 100;

export function appendLoopEntry(entry: LoopHistoryEntry): void {
  appendJsonlRecord(LOG_PATH, memoryBuffer, entry, MAX_BUFFER, (error) => {
    console.warn(
      `[loopHistory] Failed to persist loop history, using memory buffer: ${getErrorMessage(error)}`,
    );
  });
}

export function getLoopHistory(limit: number = 30): LoopHistoryEntry[] {
  const entries = readJsonlRecords<LoopHistoryEntry>(LOG_PATH, (error) => {
    if (!isFileNotFoundError(error)) {
      console.warn(
        `[loopHistory] Failed to read loop history, using memory buffer: ${getErrorMessage(error)}`,
      );
    }
  });
  if (entries) return entries.slice(-limit).reverse();
  return [...memoryBuffer].slice(-limit).reverse();
}

export function getLatestLoop(): LoopHistoryEntry | null {
  const history = getLoopHistory(1);
  return history[0] ?? null;
}

export function getLoopStats(days: number = 30): LoopStats {
  const cutoff = Date.now() - days * 86400000;
  const all = getLoopHistory(days * 2).filter((e) => e.timestamp >= cutoff);
  const successes = all.filter((e) => e.status === "success");
  const avgDurationMs =
    all.length > 0
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
