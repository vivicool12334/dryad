/**
 * In-memory photo submission store.
 * Persists to disk at DATA_DIR/submissions.json on write.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { isWithinParcels, findNearestParcel, MAX_PARCEL_DISTANCE_METERS } from './parcels.ts';
import { SUBMISSIONS } from './config/constants.ts';

export interface PhotoSubmission {
  id: string;
  type: 'plant_id' | 'proof_of_work';
  lat: number;
  lng: number;
  nearestParcel: string;
  distanceMeters: number;
  timestamp: number; // unix ms
  submittedAt: number; // unix ms
  species?: string;
  workType?: string;
  description: string;
  photoFilename: string;
  contractorName?: string;
  contractorEmail?: string;
  verified: boolean;
  verificationErrors: string[];
  processed: boolean; // has the decision loop acted on this?
  imageHash?: string; // keccak256 hash of the photo file (0x prefixed hex)
  photoPath?: string; // path on disk where photo is stored
  exifLat?: number; // GPS latitude extracted from EXIF
  exifLng?: number; // GPS longitude extracted from EXIF

  // Vision verification results
  visionScore?: number; // 0.0–1.0 confidence from vision model
  visionApproved?: boolean; // score >= threshold (auto-approved)
  visionReasoning?: string; // Model's explanation
  visionMatchedIndicators?: string[]; // Expected indicators found
  visionFlagsTriggered?: string[]; // Red flags detected
  visionModel?: string; // Which model was used
  visionVerifiedAt?: number; // When vision verification ran (unix ms)

  // Before/after comparison
  beforePhotoPath?: string; // Path to the "before" photo for comparison
  beforePhotoHash?: string; // keccak256 hash of the before photo
}

const MAX_AGE_HOURS = SUBMISSIONS.MAX_AGE_HOURS;

let submissions: PhotoSubmission[] = [];
let loaded = false;

function getStorePath(): string {
  const dataDir = process.env.PGLITE_DATA_DIR || '.eliza/.elizadb';
  const dir = path.dirname(dataDir);
  return path.join(dir, 'submissions.json');
}

function loadFromDisk() {
  if (loaded) return;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    submissions = JSON.parse(raw);
  } catch {
    submissions = [];
  }
  loaded = true;
}

function saveToDisk() {
  try {
    const dir = path.dirname(getStorePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStorePath(), JSON.stringify(submissions, null, 2));
  } catch (e) {
    console.error('Failed to save submissions:', e);
  }
}

export function validateSubmission(
  lat: number,
  lng: number,
  timestamp: number
): { valid: boolean; errors: string[]; nearestParcel: string; distance: number } {
  const errors: string[] = [];

  // GPS check
  const { parcel, distance } = findNearestParcel(lat, lng);
  if (!isWithinParcels(lat, lng) && distance > MAX_PARCEL_DISTANCE_METERS) {
    errors.push(`GPS location is ${distance.toFixed(0)}m from nearest parcel (max ${MAX_PARCEL_DISTANCE_METERS}m)`);
  }

  // Timestamp check
  const ageHours = (Date.now() - timestamp) / (1000 * 3600);
  if (ageHours < 0) {
    errors.push('Timestamp is in the future');
  } else if (ageHours > MAX_AGE_HOURS) {
    errors.push(`Photo is ${ageHours.toFixed(0)} hours old (max ${MAX_AGE_HOURS}h)`);
  }

  return {
    valid: errors.length === 0,
    errors,
    nearestParcel: parcel.address,
    distance,
  };
}

export function addSubmission(sub: Omit<PhotoSubmission, 'id' | 'submittedAt' | 'verified' | 'verificationErrors' | 'processed' | 'nearestParcel' | 'distanceMeters'> & { imageHash?: string; photoPath?: string; exifLat?: number; exifLng?: number }): PhotoSubmission {
  loadFromDisk();
  const validation = validateSubmission(sub.lat, sub.lng, sub.timestamp);
  const submission: PhotoSubmission = {
    ...sub,
    id: `sub_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
    submittedAt: Date.now(),
    nearestParcel: validation.nearestParcel,
    distanceMeters: validation.distance,
    verified: validation.valid,
    verificationErrors: validation.errors,
    processed: false,
  };
  submissions.push(submission);
  saveToDisk();
  return submission;
}

export function getSubmissions(opts?: { unprocessedOnly?: boolean; limit?: number }): PhotoSubmission[] {
  loadFromDisk();
  let result = [...submissions];
  if (opts?.unprocessedOnly) {
    result = result.filter((s) => !s.processed && s.verified);
  }
  result.sort((a, b) => b.submittedAt - a.submittedAt);
  if (opts?.limit) {
    result = result.slice(0, opts.limit);
  }
  return result;
}

export function markProcessed(ids: string[]) {
  loadFromDisk();
  for (const sub of submissions) {
    if (ids.includes(sub.id)) {
      sub.processed = true;
    }
  }
  saveToDisk();
}

export function getAllSubmissions(): PhotoSubmission[] {
  loadFromDisk();
  return [...submissions].sort((a, b) => b.submittedAt - a.submittedAt);
}

/**
 * Update a submission with vision verification results.
 */
export function updateSubmissionVision(
  id: string,
  vision: {
    score: number;
    approved: boolean;
    reasoning: string;
    matchedIndicators: string[];
    flagsTriggered: string[];
    model: string;
  },
): PhotoSubmission | null {
  loadFromDisk();
  const sub = submissions.find((s) => s.id === id);
  if (!sub) return null;

  sub.visionScore = vision.score;
  sub.visionApproved = vision.approved;
  sub.visionReasoning = vision.reasoning;
  sub.visionMatchedIndicators = vision.matchedIndicators;
  sub.visionFlagsTriggered = vision.flagsTriggered;
  sub.visionModel = vision.model;
  sub.visionVerifiedAt = Date.now();

  // If vision rejected the photo, mark as unverified
  if (!vision.approved) {
    sub.verified = false;
    if (!sub.verificationErrors.includes('Vision verification failed')) {
      sub.verificationErrors.push('Vision verification failed');
    }
  }

  saveToDisk();
  return sub;
}

/**
 * Attach a "before" photo to a submission for before/after comparison.
 */
export function setBeforePhoto(id: string, beforePhotoPath: string, beforePhotoHash?: string): PhotoSubmission | null {
  loadFromDisk();
  const sub = submissions.find((s) => s.id === id);
  if (!sub) return null;

  sub.beforePhotoPath = beforePhotoPath;
  sub.beforePhotoHash = beforePhotoHash;
  saveToDisk();
  return sub;
}

/**
 * Find a submission by ID.
 */
export function getSubmissionById(id: string): PhotoSubmission | null {
  loadFromDisk();
  return submissions.find((s) => s.id === id) || null;
}
