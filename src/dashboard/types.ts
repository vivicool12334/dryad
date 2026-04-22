import type {
  AuditEntry as RuntimeAuditEntry,
  AuditSummary,
} from "../services/auditLog.ts";
import type { HealthSnapshot as RuntimeHealthSnapshot } from "../services/healthSnapshots.ts";
import type {
  LoopHistoryEntry,
  LoopStats,
  LoopStep as RuntimeLoopStep,
} from "../services/loopHistory.ts";
import type {
  RebalanceRecord as RuntimeRebalanceRecord,
  RebalancerStatus,
} from "../services/rebalancer.ts";
import type { TreasurySnapshot as RuntimeTreasurySnapshot } from "../services/treasurySnapshots.ts";
import type {
  DeFiProtocol,
  ProtocolPosition,
  YieldSnapshot,
} from "../services/yieldMonitor.ts";
import type { TransactionRecord } from "../security/transactionGuard.ts";
import type { PhotoSubmission } from "../submissions.ts";
import type { Season, SeasonalContext } from "../utils/seasonalAwareness.ts";

type NullableValue<T> = Exclude<T, undefined> | null;

export type LoopStep = RuntimeLoopStep;
export type LoopEntry = LoopHistoryEntry;
export type TreasurySnapshot = RuntimeTreasurySnapshot;
export type HealthSnapshot = RuntimeHealthSnapshot;
export type AuditEntry = RuntimeAuditEntry;
export type Transaction = TransactionRecord;
export type RebalanceRecord = RuntimeRebalanceRecord;
export type YieldSnapshotEntry = YieldSnapshot;
export type SeasonContext = SeasonalContext & { briefing: string };

export interface LoopLatest {
  latest: LoopEntry | null;
  stats: LoopStats;
  nextRunAt: number | null;
}

export interface TreasuryCurrentData {
  wallet: string;
  ethBalance: string;
  wstethBalance: string;
  dailyYieldUSD: string;
  monthlyYieldUSD: string;
  usdcIdle: number;
  usdcDeployed: number;
  usdcTotal: number;
  blendedApy: number;
  usdcAnnualYield: number;
  usdcDailyYield: number;
}

export interface TreasuryCurrentError {
  error: string;
}

export type TreasuryCurrentResponse =
  | TreasuryCurrentData
  | TreasuryCurrentError;

export interface HealthTrendData {
  latest: HealthSnapshot | null;
  history: HealthSnapshot[];
}

export interface HealthScoreData {
  healthScore: number;
  onParcelObservations: number;
  nativeSpeciesCount: number;
  invasiveCount: number;
}

export interface Submission {
  id: PhotoSubmission["id"];
  type: PhotoSubmission["type"];
  nearestParcel: PhotoSubmission["nearestParcel"];
  timestamp: PhotoSubmission["timestamp"];
  submittedAt: PhotoSubmission["submittedAt"];
  species: NullableValue<PhotoSubmission["species"]>;
  workType: NullableValue<PhotoSubmission["workType"]>;
  description: PhotoSubmission["description"];
  photoFilename: PhotoSubmission["photoFilename"];
  contractorName: NullableValue<PhotoSubmission["contractorName"]>;
  verified: PhotoSubmission["verified"];
  processed: PhotoSubmission["processed"];
  visionScore: NullableValue<PhotoSubmission["visionScore"]>;
  visionApproved: NullableValue<PhotoSubmission["visionApproved"]>;
  visionVerifiedAt: NullableValue<PhotoSubmission["visionVerifiedAt"]>;
  hasBeforePhoto: boolean;
  pending: boolean;
  easUrl: string | null;
}

export interface ParcelGeoJsonFeature {
  properties?: Record<string, string | number | null | undefined>;
  geometry?: unknown;
}

export interface ParcelGeoJson {
  type: "FeatureCollection";
  features: ParcelGeoJsonFeature[];
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

export interface MilestonesData {
  milestones: Milestone[];
}

export interface DefiPosition extends Pick<
  ProtocolPosition,
  "protocolName" | "depositedUsd" | "depositTxHash" | "depositedAt"
> {
  currentApy: number;
  contractAddress: string | null;
}

export interface DefiProtocolInfo extends Pick<
  DeFiProtocol,
  "name" | "currentApy" | "minDeposit" | "riskScore"
> {
  address: DeFiProtocol["poolAddress"];
}

export interface DefiData {
  positions: DefiPosition[];
  protocols: DefiProtocolInfo[];
  idleUsdc: number;
  totalDeposited: number;
  totalValue: number;
  blendedApy: number;
  annualYieldUsd: number;
  dailyYieldUsd: number;
  rebalancerStatus: RebalancerStatus;
  rebalanceHistory: RebalanceRecord[];
  yieldHistory: YieldSnapshotEntry[];
}

export interface SummaryData {
  health:
    | (Pick<
        HealthSnapshot,
        | "invasivesP1"
        | "invasivesP2"
        | "invasivesP3"
        | "observationsTotal"
        | "nativeSpeciesCount"
        | "season"
        | "invasiveSpecies"
      > & {
        score: HealthSnapshot["healthScore"];
      })
    | null;
  treasury:
    | (Pick<
        TreasurySnapshot,
        | "estimatedUsd"
        | "wstEthBalance"
        | "annualYieldUsd"
        | "dailyYieldUsd"
        | "spendingMode"
      > & {
        usdcTotal: number;
        usdcDeployed: number;
        blendedApy: number;
        usdcAnnualYield: number;
      })
    | null;
  loop: {
    lastRunAt: LoopEntry["timestamp"] | null;
    lastRunStatus: LoopEntry["status"] | null;
    nextRunAt: number | null;
    stats30d: LoopStats;
  };
  season: { name: Season; description: SeasonalContext["description"] };
  demoMode: {
    active: boolean;
    cycleIntervalSec: number;
    maxPerTxUsd: number;
    maxDailyUsd: number;
    sustainabilityTarget: number;
    chain: string;
  } | null;
  auditSummary: { totalEvents24h: number; criticalEvents24h: number };
  wallet: string | null;
}

export interface AdminAuditData {
  entries: AuditEntry[];
  summary: AuditSummary;
  digest: string | null;
}

export interface AdminTransactionsData {
  history: Transaction[];
  paymentsPaused: boolean;
  dailySpendUsd: number;
  dailyLimitUsd: number;
  perTxLimitUsd: number;
}

export interface AdminStatusData {
  treasury: TreasurySnapshot | null;
  loop: {
    latest: LoopEntry | null;
    stats: LoopStats;
  };
  transactions: {
    history: Transaction[];
    paymentsPaused: boolean;
    dailySpend: number;
  };
  audit: {
    summary: AuditSummary;
    recent: AuditEntry[];
  };
  submissions: {
    total: number;
    unprocessed: number;
  };
}
