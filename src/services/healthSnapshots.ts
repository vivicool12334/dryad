/**
 * Persistent ecosystem health snapshots — one per decision loop cycle.
 * Appends to data/health-snapshots.jsonl for trend charting.
 */
import * as fs from 'fs';
import * as path from 'path';

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

export function getHealthHistory(days: number = 30): HealthSnapshot[] {
  const cutoff = Date.now() - days * 86400000;
  try {
    if (fs.existsSync(LOG_PATH)) {
      const raw = fs.readFileSync(LOG_PATH, 'utf-8').trim();
      if (!raw) return [];
      const all = raw.split('\n').filter(Boolean).map(l => JSON.parse(l) as HealthSnapshot);
      return all.filter(s => s.timestamp >= cutoff).reverse();
    }
  } catch {
    // fall through
  }
  return [...memoryBuffer].filter(s => s.timestamp >= cutoff).reverse();
}

export function getLatestHealthSnapshot(): HealthSnapshot | null {
  const history = getHealthHistory(365);
  return history[0] ?? null;
}
