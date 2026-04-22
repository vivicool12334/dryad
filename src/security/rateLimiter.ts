/**
 * Sliding window rate limiter for public endpoints.
 * Per-IP and global daily limits.
 */
import { audit } from '../services/auditLog.ts';

interface RateLimitWindow {
  count: number;
  windowStart: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const ENDPOINT_LIMITS: Record<string, RateLimitConfig> = {
  'validate_code': { windowMs: 3600000, maxRequests: 5 },   // 5/hr per IP - brute-force protection
  'contractor_apply': { windowMs: 3600000, maxRequests: 3 }, // 3/hr per IP - application spam
  'submit': { windowMs: 3600000, maxRequests: 10 },          // 10/hr per IP
  'message': { windowMs: 3600000, maxRequests: 30 },         // 30/hr per IP
  'api': { windowMs: 60000, maxRequests: 60 },               // 60/min per IP
  'security': { windowMs: 60000, maxRequests: 10 },          // 10/min per IP
  'default': { windowMs: 60000, maxRequests: 60 },           // 60/min per IP
};

const GLOBAL_DAILY_LIMITS: Record<string, number> = {
  'submit': 50,
};

const ipLimits = new Map<string, RateLimitWindow>();
const globalDailyCounts = new Map<string, { count: number; date: string }>();

export function checkRateLimit(ip: string, endpoint: string): { allowed: boolean; retryAfterMs?: number } {
  // Determine which config to use
  const configKey = Object.keys(ENDPOINT_LIMITS).find(k => endpoint.includes(k)) || 'default';
  const config = ENDPOINT_LIMITS[configKey];
  const key = `${ip}:${configKey}`;
  const now = Date.now();

  // Per-IP check
  const window = ipLimits.get(key);
  if (window) {
    if (now - window.windowStart > config.windowMs) {
      ipLimits.set(key, { count: 1, windowStart: now });
    } else if (window.count >= config.maxRequests) {
      const retryAfterMs = config.windowMs - (now - window.windowStart);
      audit('RATE_LIMIT_HIT', `IP: ${ip}, Endpoint: ${endpoint}`, 'rateLimiter', 'warn');
      return { allowed: false, retryAfterMs };
    } else {
      window.count++;
    }
  } else {
    ipLimits.set(key, { count: 1, windowStart: now });
  }

  // Global daily check
  const globalLimit = GLOBAL_DAILY_LIMITS[configKey];
  if (globalLimit) {
    const today = new Date().toISOString().split('T')[0];
    const gc = globalDailyCounts.get(configKey);
    if (gc && gc.date === today) {
      if (gc.count >= globalLimit) {
        audit('RATE_LIMIT_HIT', `Global daily limit: ${endpoint} (${gc.count}/${globalLimit})`, 'rateLimiter', 'warn');
        return { allowed: false };
      }
      gc.count++;
    } else {
      globalDailyCounts.set(configKey, { count: 1, date: today });
    }
  }

  return { allowed: true };
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 7200000; // 2 hours
  for (const [key, w] of ipLimits.entries()) {
    if (w.windowStart < cutoff) ipLimits.delete(key);
  }
}, 600000);
