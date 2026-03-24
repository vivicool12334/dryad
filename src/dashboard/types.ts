// Shared API response types for the Dryad monitoring dashboard.
// These mirror the JSON shapes returned by the /Dryad/api/* endpoints.

export interface LoopStep {
  name: string;
  result: string;
  durationMs: number;
  status: 'ok' | 'error' | 'skipped';
}

export interface LoopEntry {
  timestamp: number;
  status: 'success' | 'failure';
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

export interface LoopLatest {
  latest: LoopEntry | null;
  stats: LoopStats;
  nextRunAt: number | null;
}

export interface TreasurySnapshot {
  timestamp: number;
  wstEthBalance: string;
  ethBalance: string;
  ethPriceUsd: number;
  estimatedUsd: number;
  annualYieldUsd: number;
  dailyYieldUsd: number;
  spendingMode: 'NORMAL' | 'CONSERVATION' | 'CRITICAL';
  dailySpendUsd: number;
  diemBalance: string;
}

export interface HealthSnapshot {
  timestamp: number;
  healthScore: number;
  invasivesP1: number;
  invasivesP2: number;
  invasivesP3: number;
  observationsTotal: number;
  nativeSpeciesCount: number;
  nativeIndicatorCount: number;
  season: string;
  seasonalMultiplier: number;
  invasiveSpecies: string[];
}

export interface SeasonContext {
  season: string;
  description: string;
  priorities: string[];
  contractorWorkTypes: string[];
  healthScoreThresholdMultiplier: number;
  plantingAppropriate: boolean;
  mowingAppropriate: boolean;
  briefing: string;
}

export interface AuditEntry {
  timestamp: string;
  type: string;
  details: string;
  source: string;
  severity: 'info' | 'warn' | 'critical';
  metadata?: Record<string, unknown>;
}

export interface Transaction {
  timestamp: number;
  amount: number;
  recipient: string;
  txHash?: string;
}

export interface Submission {
  id: string;
  type: 'plant_id' | 'proof_of_work';
  lat: number;
  lng: number;
  nearestParcel: string;
  distanceMeters: number;
  timestamp: number;
  submittedAt: number;
  species?: string;
  workType?: string;
  description: string;
  photoFilename: string;
  contractorName?: string;
  verified: boolean;
  verificationErrors: string[];
  processed: boolean;
}

export interface Milestone {
  id: number;
  milestoneType: number;
  parcel: string;
  description: string;
  dataHash: string;
  timestamp: number;
  recorder: string;
}

export interface SummaryData {
  health: {
    score: number;
    invasivesP1: number;
    invasivesP2: number;
    invasivesP3: number;
    observationsTotal: number;
    nativeSpeciesCount: number;
    season: string;
    invasiveSpecies: string[];
  } | null;
  treasury: {
    estimatedUsd: number;
    wstEthBalance: string;
    annualYieldUsd: number;
    dailyYieldUsd: number;
    spendingMode: 'NORMAL' | 'CONSERVATION' | 'CRITICAL';
  } | null;
  loop: {
    lastRunAt: number | null;
    lastRunStatus: string | null;
    nextRunAt: number | null;
    stats30d: LoopStats;
  };
  season: { name: string; description: string };
  auditSummary: { totalEvents24h: number; criticalEvents24h: number };
  wallet: string | null;
}
