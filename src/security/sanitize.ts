/**
 * Input sanitization for all text entering the Dryad agent.
 * Detects prompt injection, unknown wallet addresses, and cleans input.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /you\s+are\s+now/i,
  /system\s*:\s*/i,
  /admin\s*:\s*/i,
  /override\s+(security|safety|rules|limits)/i,
  /developer\s+mode/i,
  /bypass\s+(spending|limit|security)/i,
  /transfer\s+(all|everything|funds)\s+to/i,
  /emergency\s*:\s*bypass/i,
  /for\s+testing\s+purposes?\s*,?\s*(send|transfer|pay)/i,
  /nick\s+said\s+to\s+(transfer|send|pay)/i,
  /new\s+directive/i,
  /disregard\s+(previous|above|prior)/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+if/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /what\s+are\s+your\s+(instructions|rules)/i,
];

const KNOWN_ADDRESSES = [
  process.env.EVM_PRIVATE_KEY ? '0xf2f7527D86e2173c91fF1c10Ede03f6f84510880' : '',
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', // wstETH
  '0xf4d97f2da56e8c3098f3a8d538db630a2606a024', // DIEM
  '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3
  '0x7572dcac88720470d8cc827be5b02d474951bc22', // Milestones
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // ERC-8004
].filter((a): a is string => !!a).map(a => a.toLowerCase());

export function isInjectionAttempt(input: string): { detected: boolean; pattern?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
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

const securityLog: Array<{ timestamp: string; event: string; details: string; source: string }> = [];

export function logSecurityEvent(event: string, details: string, source: string): void {
  const entry = { timestamp: new Date().toISOString(), event, details, source };
  securityLog.push(entry);
  console.warn(`[SECURITY] ${event}: ${details} (source: ${source})`);
  if (securityLog.length > 1000) securityLog.splice(0, securityLog.length - 1000);
}

export function getSecurityLog() { return [...securityLog]; }
