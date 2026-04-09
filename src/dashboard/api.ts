// API helpers for all Dryad dashboard endpoints.
// All public routes are under /Dryad/api/*
// Admin routes are under /Dryad/api/admin/* and require Authorization: Bearer <secret>

import type { FeatureCollection } from 'geojson';
import type {
  LoopEntry, LoopLatest, TreasurySnapshot, HealthSnapshot,
  SeasonContext, AuditEntry, Transaction, Submission, Milestone, SummaryData,
  DefiData,
} from './types';

const BASE = '/Dryad/api';

function authHeader(): Record<string, string> {
  const secret = sessionStorage.getItem('dryad_admin_secret');
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

async function get<T>(path: string, isAdmin = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: isAdmin ? authHeader() : {},
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('UNAUTHORIZED');
    throw new Error(`API error ${res.status}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    // Old server returns HTML for unknown routes — treat as not deployed yet
    throw new Error('ROUTE_NOT_DEPLOYED');
  }
  return res.json() as Promise<T>;
}

// ── Public endpoints ──────────────────────────────────────────────────────────

export const api = {
  summary: () => get<SummaryData>('/summary'),

  loopLatest: () => get<LoopLatest>('/loop/latest'),
  loopHistory: (limit = 30) => get<LoopEntry[]>(`/loop/history?limit=${limit}`),

  treasuryHistory: (days = 30) => get<TreasurySnapshot[]>(`/treasury/history?days=${days}`),
  treasuryCurrent: () => get<{ wallet: string; ethBalance: string; wstethBalance: string; dailyYieldUSD: string; monthlyYieldUSD: string; usdcIdle?: number; usdcDeployed?: number; usdcTotal?: number; blendedApy?: number; usdcAnnualYield?: number; usdcDailyYield?: number }>('/treasury'),

  healthTrend: (days = 30) => get<{ latest: HealthSnapshot | null; history: HealthSnapshot[] }>(`/health/trend?days=${days}`),
  healthScore: () => get<{ healthScore: number; onParcelObservations: number; nativeSpeciesCount: number; invasiveCount: number }>('/health-score'),

  season: () => get<SeasonContext>('/season'),

  milestones: () => get<{ milestones: Milestone[] }>('/milestones'),

  submissions: () => get<Submission[]>('/submissions'),

  defi: (yieldDays = 7) => get<DefiData>(`/defi?yieldDays=${yieldDays}`),

  parcelsGeoJson: () => get<FeatureCollection>('/parcels/geojson'),

  // ── Admin endpoints ─────────────────────────────────────────────────────────

  adminAudit: (count = 100) => get<{ entries: AuditEntry[]; summary: any; digest: string | null }>(`/admin/audit?count=${count}`, true),

  adminTransactions: () => get<{ history: Transaction[]; paymentsPaused: boolean; dailySpendUsd: number; dailyLimitUsd: number; perTxLimitUsd: number }>('/admin/transactions', true),

  adminStatus: () => get<any>('/admin/status', true),
};

// Auth helpers
export function getStoredSecret(): string | null {
  return sessionStorage.getItem('dryad_admin_secret');
}
export function setStoredSecret(secret: string): void {
  sessionStorage.setItem('dryad_admin_secret', secret);
}
export function clearStoredSecret(): void {
  sessionStorage.removeItem('dryad_admin_secret');
}
export function isAuthenticated(): boolean {
  return !!getStoredSecret();
}
