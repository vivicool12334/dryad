// API helpers for all Dryad dashboard endpoints.
// All public routes are under /Dryad/api/*
// Admin routes are under /Dryad/api/admin/* and require Authorization: Bearer <secret>

import type {
  AdminAuditData,
  AdminStatusData,
  AdminTransactionsData,
  DefiData,
  HealthScoreData,
  HealthTrendData,
  LoopEntry,
  LoopLatest,
  MilestonesData,
  ParcelGeoJson,
  SeasonContext,
  Submission,
  SummaryData,
  TreasuryCurrentResponse,
  TreasurySnapshot,
} from "./types";

const BASE = "/Dryad/api";

function authHeader(): Record<string, string> {
  const secret = sessionStorage.getItem("dryad_admin_secret");
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

async function get<T>(path: string, isAdmin = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: isAdmin ? authHeader() : {},
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("UNAUTHORIZED");
    throw new Error(`API error ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    // Old server returns HTML for unknown routes - treat as not deployed yet
    throw new Error("ROUTE_NOT_DEPLOYED");
  }
  return res.json() as Promise<T>;
}

// ── Public endpoints ──────────────────────────────────────────────────────────

export const api = {
  summary: () => get<SummaryData>("/summary"),

  loopLatest: () => get<LoopLatest>("/loop/latest"),
  loopHistory: (limit = 30) => get<LoopEntry[]>(`/loop/history?limit=${limit}`),

  treasuryHistory: (days = 30) =>
    get<TreasurySnapshot[]>(`/treasury/history?days=${days}`),
  treasuryCurrent: () => get<TreasuryCurrentResponse>("/treasury"),

  healthTrend: (days = 30) =>
    get<HealthTrendData>(`/health/trend?days=${days}`),
  healthScore: () => get<HealthScoreData>("/health-score"),

  season: () => get<SeasonContext>("/season"),

  milestones: () => get<MilestonesData>("/milestones"),

  submissions: () => get<Submission[]>("/submissions"),

  defi: (yieldDays = 7) => get<DefiData>(`/defi?yieldDays=${yieldDays}`),

  parcelsGeoJson: () => get<ParcelGeoJson>("/parcels/geojson"),

  // ── Admin endpoints ─────────────────────────────────────────────────────────

  adminAudit: (count = 100) =>
    get<AdminAuditData>(`/admin/audit?count=${count}`, true),

  adminTransactions: () =>
    get<AdminTransactionsData>("/admin/transactions", true),

  adminStatus: () => get<AdminStatusData>("/admin/status", true),
};

// Auth helpers
function getStoredSecret(): string | null {
  return sessionStorage.getItem("dryad_admin_secret");
}
export function setStoredSecret(secret: string): void {
  sessionStorage.setItem("dryad_admin_secret", secret);
}
export function clearStoredSecret(): void {
  sessionStorage.removeItem("dryad_admin_secret");
}
export function isAuthenticated(): boolean {
  return !!getStoredSecret();
}
