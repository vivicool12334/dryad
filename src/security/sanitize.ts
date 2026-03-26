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

const KNOWN_ADDRESSES = [
  '0xf2f7527D86e2173c91fF1c10Ede03f6f84510880', // Dryad wallet
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', // wstETH
  '0xf4d97f2da56e8c3098f3a8d538db630a2606a024', // DIEM
  '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3
  '0x7572dcac88720470d8cc827be5b02d474951bc22', // Milestones
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // ERC-8004
].map(a => a.toLowerCase());

export function isInjectionAttempt(input: string): { detected: boolean; pattern?: string } {
  const normalized = normalizeForInjectionCheck(input);
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { detected: true, pattern: pattern.source };
    }
  }
  return { detected: false };
}

export function containsUnknownWalletAddress(input: string): { found: boolean; addresses: string[] } {
  const matches: string[] = input.match(/0x[a-fA-F0-9]{40}/g) || [];
  const unknown = matches.filter((addr: string) => !KNOWN_ADDRESSES.includes(addr.toLowerCase()));
  return { found: unknown.length > 0, addresses: unknown };
}

export function sanitizeText(input: string): string {
  return input.replace(/<[^>]*>/g, '').replace(/\0/g, '').slice(0, 2000);
}

export function sanitizeSubmissionDescription(input: string): string {
  return sanitizeText(input).slice(0, 500);
}

export function validateImageUpload(mimeType: string, sizeBytes: number): { valid: boolean; reason?: string } {
  const ALLOWED = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
  const MAX = 10 * 1024 * 1024;
  if (!ALLOWED.includes(mimeType.toLowerCase())) return { valid: false, reason: `File type ${mimeType} not accepted. Use JPEG, PNG, or HEIC.` };
  if (sizeBytes > MAX) return { valid: false, reason: `File too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Max 10MB.` };
  return { valid: true };
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
