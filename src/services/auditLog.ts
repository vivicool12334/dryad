/**
 * Persistent audit logging for all security-relevant events.
 * Writes to both in-memory buffer and append-only JSONL file.
 */
import * as fs from 'fs';
import * as path from 'path';

export type AuditEventType =
  | 'TRANSACTION_SUCCESS' | 'TRANSACTION_FAILED' | 'TRANSACTION_BLOCKED'
  | 'INJECTION_ATTEMPT' | 'ADDRESS_ALLOWLISTED' | 'ADDRESS_BLOCKED'
  | 'CONTRACTOR_ONBOARDED' | 'CONTRACTOR_DEACTIVATED'
  | 'API_FAILURE' | 'RATE_LIMIT_HIT'
  | 'LOOP_EXECUTION' | 'LOOP_FAILURE'
  | 'MILESTONE_RECORDED' | 'PAYMENTS_PAUSED' | 'PAYMENTS_RESUMED'
  | 'TREASURY_MODE_CHANGE'
  | 'SUBMISSION_RECEIVED' | 'SUBMISSION_REJECTED'
  | 'EMAIL_SENT' | 'EMAIL_RECEIVED'
  | 'UNKNOWN_ADDRESS_DETECTED'
  | 'VISION_VERIFY' | 'VISION_VERIFY_COMPARE'
  | 'AUTORESEARCH'
  | 'DEFI_DEPOSIT' | 'DEFI_WITHDRAW'
  | 'REBALANCE_EXECUTED' | 'REBALANCE_ERROR'
  | 'YIELD_MONITOR'
  | 'ADMIN_ACTION'
  | 'CONTRACTOR_APPROVED' | 'CONTRACTOR_NEEDS_REVIEW';

export interface AuditEntry {
  timestamp: string;
  type: AuditEventType;
  details: string;
  source: string;
  severity: 'info' | 'warn' | 'critical';
  metadata?: Record<string, unknown>;
}

const AUDIT_LOG_PATH = path.join(process.cwd(), 'data', 'audit-log.jsonl');
const memoryBuffer: AuditEntry[] = [];
const MAX_BUFFER = 500;

export function audit(
  type: AuditEventType,
  details: string,
  source: string,
  severity: 'info' | 'warn' | 'critical' = 'info',
  metadata?: Record<string, unknown>
): void {
  const entry: AuditEntry = { timestamp: new Date().toISOString(), type, details, source, severity, metadata };

  memoryBuffer.push(entry);
  if (memoryBuffer.length > MAX_BUFFER) memoryBuffer.shift();

  try {
    const dir = path.dirname(AUDIT_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Memory buffer is the fallback
  }

  if (severity === 'critical') console.error(`[AUDIT CRITICAL] ${type}: ${details} (${source})`);
  else if (severity === 'warn') console.warn(`[AUDIT WARN] ${type}: ${details}`);
}

export function getRecentAuditEntries(count: number = 50, type?: AuditEventType): AuditEntry[] {
  let entries = [...memoryBuffer];
  if (type) entries = entries.filter(e => e.type === type);
  return entries.slice(-count);
}

export function getAuditSummary(hours: number = 24): {
  totalEvents: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  criticalEvents: AuditEntry[];
} {
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  const recent = memoryBuffer.filter(e => e.timestamp > cutoff);

  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const criticalEvents: AuditEntry[] = [];

  for (const entry of recent) {
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    if (entry.severity === 'critical') criticalEvents.push(entry);
  }

  return { totalEvents: recent.length, bySeverity, byType, criticalEvents };
}

export function getDailyDigest(): string | null {
  const summary = getAuditSummary(24);
  if (summary.totalEvents === 0) return null;

  let digest = `Security Digest — ${new Date().toISOString().split('T')[0]}\n\n`;
  digest += `Total events: ${summary.totalEvents}\n`;
  digest += `By severity: ${Object.entries(summary.bySeverity).map(([k, v]) => `${k}: ${v}`).join(', ')}\n\n`;

  if (summary.criticalEvents.length > 0) {
    digest += `CRITICAL EVENTS:\n`;
    for (const e of summary.criticalEvents) {
      digest += `  - [${e.timestamp}] ${e.type}: ${e.details}\n`;
    }
    digest += '\n';
  }

  digest += `Breakdown:\n`;
  for (const [type, count] of Object.entries(summary.byType).sort((a, b) => b[1] - a[1])) {
    digest += `  ${type}: ${count}\n`;
  }

  return digest;
}
