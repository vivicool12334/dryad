/**
 * Input sanitization for all text entering the Dryad agent.
 * Detects prompt injection, unknown wallet addresses, and cleans input.
 */

// Normalize text before injection checking: collapse all whitespace variants
// (Unicode spaces, zero-width chars, newlines) to single space to defeat bypass attempts
function normalizeForInjectionCheck(input: string): string {
  return input
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ') // Unicode spaces
    .replace(/\u200B|\u200C|\u200D|\u2060|\uFEFF/g, '') // Zero-width chars
    .replace(/[\r\n\t]+/g, ' ') // Newlines/tabs
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
    .toLowerCase();
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/,
  /you\s+are\s+now/,
  /system\s*:\s*/,
  /admin\s*:\s*/,
  /override\s+(security|safety|rules|limits)/,
  /developer\s+mode/,
  /bypass\s+(spending|limit|security)/,
  /transfer\s+(all|everything|funds)\s+to/,
  /emergency\s*:\s*bypass/,
  /for\s+testing\s+purposes?\s*,?\s*(send|transfer|pay)/,
  /nick\s+said\s+to\s+(transfer|send|pay)/,
  /new\s+directive/,
  /disregard\s+(previous|above|prior)/,
  /pretend\s+you\s+are/,
  /act\s+as\s+if/,
  /reveal\s+(your\s+)?(system\s+)?prompt/,
  /what\s+are\s+your\s+(instructions|rules)/,
  // Additional patterns for common bypass techniques
  /do\s+anything\s+now/,
  /jailbreak/,
  /prompt\s+injection/,
  /ignore\s+above/,
  /forget\s+(previous|prior|all|your)\s+(instructions?|context|rules)/,
  /new\s+role\s*:/,
  /act\s+as\s+(an?\s+)?(?:unrestricted|unfiltered|evil|dan|jailbroken)/,
];

export function isInjectionAttempt(input: string): { detected: boolean; pattern?: string } {
  const normalized = normalizeForInjectionCheck(input);
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false };
}

function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, '').replace(/\0/g, '').slice(0, 2000);
}

export function sanitizeSubmissionDescription(input: string): string {
  return sanitizeText(input).slice(0, 500);
}

import { audit, getRecentAuditEntries, type AuditEventType } from '../services/auditLog.ts';

export function logSecurityEvent(event: string, details: string, source: string): void {
  audit(event as AuditEventType, details, source, 'warn');
}

export function getSecurityLog() {
  return getRecentAuditEntries(100).map(e => ({
    timestamp: e.timestamp,
    event: e.type,
    details: e.details,
    source: e.source,
  }));
}
