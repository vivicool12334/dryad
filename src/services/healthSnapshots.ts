/**
 * Persistent ecosystem health snapshots - one per decision loop cycle.
 * Appends to data/health-snapshots.jsonl for trend charting.
 */
import * as path from 'path';
import { getErrorMessage, isFileNotFoundError } from '../utils/fileErrors.ts';
import { appendJsonlRecord, readJsonlRecords } from '../utils/jsonlLog.ts';

export interface HealthSnapshot {
  timestamp: number;
  healthScore: number;       // 0–100
  invasivesP1: number;       // woody invaders (most urgent)
  invasivesP2: number;       // herbaceous invaders
  invasivesP3: number;       // Tree of Heaven
  observationsTotal: number; // all iNaturalist obs on parcels
  nativeSpeciesCount: number;
  nativeIndicatorCount: number;
  season: string;
  seasonalMultiplier: number;
  invasiveSpecies: string[];  // list of detected common names
}

const LOG_PATH = path.join(process.cwd(), 'data', 'health-snapshots.jsonl');
const memoryBuffer: HealthSnapshot[] = [];
const MAX_BUFFER = 365;

export function appendHealthSnapshot(snap: HealthSnapshot): void {
  appendJsonlRecord(LOG_PATH, memoryBuffer, snap, MAX_BUFFER, (error) => {
    console.warn(`[healthSnapshots] Failed to persist health snapshot, using memory buffer: ${getErrorMessage(error)}`);
  });
}

export function getHealthHistory(days: number = 30): HealthSnapshot[] {
  const cutoff = Date.now() - days * 86400000;
  const history = readJsonlRecords<HealthSnapshot>(LOG_PATH, (error) => {
    if (!isFileNotFoundError(error)) {
      console.warn(`[healthSnapshots] Failed to read health snapshots, using memory buffer: ${getErrorMessage(error)}`);
    }
  });
  if (history) return history.filter((snapshot) => snapshot.timestamp >= cutoff).reverse();
  return [...memoryBuffer].filter(s => s.timestamp >= cutoff).reverse();
}

export function getLatestHealthSnapshot(): HealthSnapshot | null {
  const history = getHealthHistory(365);
  return history[0] ?? null;
}
