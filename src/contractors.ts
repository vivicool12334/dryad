/**
 * Contractor registry — stores approved contractors and their access codes.
 * Persists to disk at DATA_DIR/contractors.json on write.
 *
 * Flow:
 *   1. Contractor fills out /Dryad/apply form
 *   2. Application stored as "pending"
 *   3. Agent reviews and approves → generates access code
 *   4. Contractor uses access code on /Dryad/submit to unlock the form
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type ContractorStatus = 'pending' | 'approved' | 'suspended' | 'rejected';

export interface Contractor {
  id: string;
  status: ContractorStatus;
  accessCode: string | null; // e.g. "DRYAD-7K2M" — null until approved

  // Identity
  name: string;
  email: string;
  phone: string;
  walletAddress: string; // Base L2 address for USDC payment

  // Work info
  experience: string; // brief description of relevant experience
  workTypes: string[]; // what types of work they can do

  // Tracking
  appliedAt: number; // unix ms
  approvedAt: number | null;
  suspendedAt: number | null;
  suspendedReason: string | null;

  // Stats
  totalSubmissions: number;
  totalApprovedSubmissions: number;
  totalPaidUsd: number;
  lastSubmissionAt: number | null;

  // Tax threshold tracking
  ytdPaidUsd: number; // year-to-date payments
  w9Requested: boolean;
  w9ReceivedAt: number | null;

  // Device fingerprint (light — for abuse detection)
  knownUserAgents: string[];
  lastIp: string | null;
}

let contractors: Contractor[] = [];
let loaded = false;

function getStorePath(): string {
  const dataDir = process.env.PGLITE_DATA_DIR || '.eliza/.elizadb';
  const dir = path.dirname(dataDir);
  return path.join(dir, 'contractors.json');
}

function loadFromDisk() {
  if (loaded) return;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    contractors = JSON.parse(raw);
  } catch {
    contractors = [];
  }
  loaded = true;
}

function saveToDisk() {
  try {
    const dir = path.dirname(getStorePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStorePath(), JSON.stringify(contractors, null, 2));
  } catch (e) {
    console.error('Failed to save contractors:', e);
  }
}

/**
 * Generate a human-readable access code like "DRYAD-7K2M"
 */
function generateAccessCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return `DRYAD-${code}`;
}

/**
 * Submit a new contractor application.
 */
export function applyContractor(app: {
  name: string;
  email: string;
  phone: string;
  walletAddress: string;
  experience: string;
  workTypes: string[];
}): Contractor {
  loadFromDisk();

  // Check for duplicate email
  const existing = contractors.find(
    (c) => c.email.toLowerCase() === app.email.toLowerCase() && c.status !== 'rejected'
  );
  if (existing) {
    throw new Error('An application with this email already exists');
  }

  const contractor: Contractor = {
    id: `ctr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    status: 'pending',
    accessCode: null,
    name: app.name,
    email: app.email,
    phone: app.phone,
    walletAddress: app.walletAddress,
    experience: app.experience,
    workTypes: app.workTypes,
    appliedAt: Date.now(),
    approvedAt: null,
    suspendedAt: null,
    suspendedReason: null,
    totalSubmissions: 0,
    totalApprovedSubmissions: 0,
    totalPaidUsd: 0,
    lastSubmissionAt: null,
    ytdPaidUsd: 0,
    w9Requested: false,
    w9ReceivedAt: null,
    knownUserAgents: [],
    lastIp: null,
  };

  contractors.push(contractor);
  saveToDisk();
  return contractor;
}

/**
 * Approve a contractor and generate their access code.
 */
export function approveContractor(id: string): Contractor | null {
  loadFromDisk();
  const c = contractors.find((x) => x.id === id);
  if (!c) return null;

  // Generate unique code
  let code: string;
  do {
    code = generateAccessCode();
  } while (contractors.some((x) => x.accessCode === code));

  c.status = 'approved';
  c.accessCode = code;
  c.approvedAt = Date.now();
  saveToDisk();
  return c;
}

/**
 * Suspend a contractor (revoke access).
 */
export function suspendContractor(id: string, reason: string): Contractor | null {
  loadFromDisk();
  const c = contractors.find((x) => x.id === id);
  if (!c) return null;
  c.status = 'suspended';
  c.suspendedAt = Date.now();
  c.suspendedReason = reason;
  saveToDisk();
  return c;
}

/**
 * Validate an access code. Returns the contractor if valid, null if not.
 */
export function validateAccessCode(code: string): Contractor | null {
  loadFromDisk();
  const normalized = code.trim().toUpperCase();
  const c = contractors.find((x) => x.accessCode === normalized && x.status === 'approved');
  return c || null;
}

/**
 * Record a submission for a contractor.
 */
export function recordSubmission(contractorId: string, approved: boolean): void {
  loadFromDisk();
  const c = contractors.find((x) => x.id === contractorId);
  if (!c) return;
  c.totalSubmissions++;
  if (approved) c.totalApprovedSubmissions++;
  c.lastSubmissionAt = Date.now();
  saveToDisk();
}

/**
 * Record a payment for a contractor.
 */
export function recordPayment(contractorId: string, amountUsd: number): void {
  loadFromDisk();
  const c = contractors.find((x) => x.id === contractorId);
  if (!c) return;
  c.totalPaidUsd += amountUsd;
  c.ytdPaidUsd += amountUsd;
  saveToDisk();
}

/**
 * Update device fingerprint info.
 */
export function updateDeviceInfo(contractorId: string, userAgent: string, ip: string): void {
  loadFromDisk();
  const c = contractors.find((x) => x.id === contractorId);
  if (!c) return;
  if (!c.knownUserAgents.includes(userAgent)) {
    c.knownUserAgents.push(userAgent);
  }
  c.lastIp = ip;
  saveToDisk();
}

/**
 * Get all contractors.
 */
export function getAllContractors(): Contractor[] {
  loadFromDisk();
  return [...contractors].sort((a, b) => b.appliedAt - a.appliedAt);
}

/**
 * Get pending applications.
 */
export function getPendingApplications(): Contractor[] {
  loadFromDisk();
  return contractors.filter((c) => c.status === 'pending').sort((a, b) => b.appliedAt - a.appliedAt);
}

/**
 * Get a contractor by ID.
 */
export function getContractorById(id: string): Contractor | null {
  loadFromDisk();
  return contractors.find((c) => c.id === id) || null;
}

/**
 * Get contractors approaching W-9 threshold ($600 YTD).
 */
export function getContractorsNearingW9Threshold(): Contractor[] {
  loadFromDisk();
  return contractors.filter((c) => c.ytdPaidUsd >= 500 && !c.w9Requested);
}

/**
 * Mark W-9 as requested for a contractor.
 */
export function markW9Requested(id: string): void {
  loadFromDisk();
  const c = contractors.find((x) => x.id === id);
  if (!c) return;
  c.w9Requested = true;
  saveToDisk();
}

/**
 * Check daily submission rate for a contractor (anti-spam).
 */
export function getContractorDailySubmissionCount(contractorId: string, allSubmissions: Array<{ contractorId?: string; submittedAt: number }>): number {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return allSubmissions.filter(
    (s) => (s as any).contractorId === contractorId && s.submittedAt >= dayStart.getTime()
  ).length;
}
