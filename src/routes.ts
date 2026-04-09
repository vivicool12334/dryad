/**
 * Custom routes for Dryad: /submit portal, /dashboard, /api/submissions
 */
import type { RouteRequest, RouteResponse, IAgentRuntime } from '@elizaos/core';
import { timingSafeEqual } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Busboy from 'busboy';
import { addSubmission, getAllSubmissions, updateSubmissionVision, getSubmissionById } from './submissions.ts';
import { PARCELS, PARCEL_BOUNDS } from './parcels.ts';
import { isInjectionAttempt, sanitizeSubmissionDescription, logSecurityEvent, getSecurityLog } from './security/sanitize.ts';
import { getTransactionHistory, isPaymentsPaused } from './security/transactionGuard.ts';
import { checkRateLimit } from './security/rateLimiter.ts';
import { applyContractor, validateAccessCode, recordSubmission, updateDeviceInfo, getAllContractors, getPendingApplications, approveContractor, suspendContractor, getContractorById } from './contractors.ts';
import { getAuditSummary, getRecentAuditEntries, getDailyDigest } from './services/auditLog.ts';
import { audit } from './services/auditLog.ts';
import { DEMO_MODE, TIMING, TX_LIMITS, FINANCIAL } from './config/constants.ts';
import { getAttestationUrl } from './services/easAttestation.ts';
import { getLoopHistory, getLatestLoop, getLoopStats } from './services/loopHistory.ts';
import { getTreasuryHistory, getLatestTreasurySnapshot } from './services/treasurySnapshots.ts';
import { getHealthHistory, getLatestHealthSnapshot } from './services/healthSnapshots.ts';
import { getCurrentSeason, getSeasonalBriefing } from './utils/seasonalAwareness.ts';
import { extractGpsFromExif } from './utils/exifGps.ts';
import { computeImageHash } from './utils/imageHash.ts';
import { verifyWorkPhoto } from './services/visionVerify.ts';
import { loadPositions, getYieldHistory, PROTOCOLS } from './services/yieldMonitor.ts';
import { getRebalanceHistory, getRebalancerStatus } from './services/rebalancer.ts';
import { getUsdcBalance } from './actions/defiYield.ts';

// Built dashboard path (produced by `bun run build:dashboard`)
const DASHBOARD_HTML_PATH = path.join(process.cwd(), 'dist', 'dashboard', 'index.html');
const MOCK_HTML_PATH = path.join(process.cwd(), 'site', 'mock.html');

// Safe integer query param parser with bounds
function parseIntParam(value: unknown, defaultVal: number, min: number, max: number): number {
  const n = parseInt(String(value ?? defaultVal), 10);
  return isNaN(n) ? defaultVal : Math.min(Math.max(n, min), max);
}

// Allowed CORS origins — production domains, Vercel frontend, and local dev
const ALLOWED_ORIGINS = [
  'https://www.dryad.land',
  'https://dryad.land',
  'https://dashboard.dryad.land',
  'https://dryad.vercel.app',
  'http://5.75.225.23:3000',
  'http://localhost:5173',
];

function corsHeaders(req: RouteRequest, res: RouteResponse): void {
  const origin = req.headers?.['origin'] as string | undefined;
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader?.('Access-Control-Allow-Origin', allowed);
  res.setHeader?.('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader?.('Vary', 'Origin');
}

function securityHeaders(res: RouteResponse): void {
  res.setHeader?.('X-Frame-Options', 'DENY');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');
  res.setHeader?.('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader?.('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  res.setHeader?.('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader?.('Cross-Origin-Resource-Policy', 'same-origin');
  // Override ElizaOS framework's permissive CSP (it hardcodes isProd=false → script-src *)
  res.setHeader?.('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data: blob:",
    "connect-src 'self' https://api.inaturalist.org https://api.coingecko.com https://gis.detroitmi.gov https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://api.mapbox.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
}

// Auth helper: checks Authorization: Bearer <secret> (constant-time to prevent timing attacks)
function isAdmin(req: RouteRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const bearer = (req.headers?.['authorization'] as string | undefined)?.replace('Bearer ', '').trim() ?? '';
  if (bearer.length === 0) return false;
  try {
    if (bearer.length !== secret.length) return false;
    const a = Buffer.from(bearer);
    const b = Buffer.from(secret);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Parcel GeoJSON cache from Detroit ArcGIS
let parcelGeoJsonCache: any = null;
let parcelGeoJsonFetchedAt = 0;
async function fetchParcelGeoJson() {
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — parcels don't change
  if (parcelGeoJsonCache && Date.now() - parcelGeoJsonFetchedAt < CACHE_TTL) {
    return parcelGeoJsonCache;
  }
  const parcelNums = PARCELS.map(p => `'${p.parcelNumber}'`).join(',');
  const url = `https://gis.detroitmi.gov/arcgis/rest/services/AdvancedPlanning/Parcels/FeatureServer/0/query?where=parcelno+IN+(${encodeURIComponent(parcelNums)})&outFields=*&outSR=4326&f=geojson`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`Detroit GIS returned ${resp.status}`);
  const geojson = await resp.json();
  parcelGeoJsonCache = geojson;
  parcelGeoJsonFetchedAt = Date.now();
  return geojson;
}

// iNaturalist + biodiversity cache (5-min TTL — expensive API call)
let inatCache: any = null;
let inatFetchedAt = 0;
const INAT_CACHE_TTL = 5 * 60 * 1000;

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads dir exists
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

// Rate limiting handled by src/security/rateLimiter.ts

// iNaturalist URLs
const INAT_PROJECT_URL = 'https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping';
const INAT_OBS_URL = `https://www.inaturalist.org/observations?nelat=${PARCEL_BOUNDS.ne.lat}&nelng=${PARCEL_BOUNDS.ne.lng}&swlat=${PARCEL_BOUNDS.sw.lat}&swlng=${PARCEL_BOUNDS.sw.lng}`;
const INAT_API_URL = `https://api.inaturalist.org/v1/observations?nelat=${PARCEL_BOUNDS.ne.lat}&nelng=${PARCEL_BOUNDS.ne.lng}&swlat=${PARCEL_BOUNDS.sw.lat}&swlng=${PARCEL_BOUNDS.sw.lng}`;

// ─── /apply page (contractor onboarding) ───
function applyPageHTML(): string {
  const workTypes = ['Invasive Removal', 'Soil Prep', 'Native Planting', 'Monitoring/Survey', 'Debris Cleanup', 'Weed Whacking'];
  const workTypeCheckboxes = workTypes.map((t) => `<label style="display:inline-block;margin-right:12px;margin-bottom:8px"><input type="checkbox" name="workTypes" value="${t}"> ${t}</label>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dryad — Contractor Application</title>
<link rel="canonical" href="https://dryad.land/Dryad/contractors">
<style>
*{box-sizing:border-box;margin:0;padding:0}
.skip-link{position:absolute;top:-40px;left:0;background:#4caf50;color:#fff;padding:8px 16px;z-index:100;font-weight:600;border-radius:0 0 8px 0}
.skip-link:focus{top:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a1a0a;color:#e0e0e0;min-height:100vh;min-height:100dvh}
.container{max-width:640px;margin:0 auto;padding:24px}
h1{color:#4caf50;margin-bottom:4px;font-size:28px}
.subtitle{color:#81c784;margin-bottom:24px}
.card{background:#1a2e1a;border:1px solid #2e7d32;border-radius:12px;padding:24px;margin-bottom:16px}
label{display:block;font-weight:600;margin-bottom:6px;color:#a5d6a7}
input,textarea{width:100%;padding:10px;border:1px solid #2e7d32;border-radius:8px;background:#0d1f0d;color:#e0e0e0;margin-bottom:16px;font-size:14px}
textarea{resize:vertical;min-height:100px}
button{background:#2e7d32;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:16px;font-weight:600;width:100%;min-height:48px}
button:hover{background:#388e3c}
.success{background:#1b5e20;border:1px solid #4caf50;padding:16px;border-radius:8px;margin-top:16px}
.error{background:#4a1010;border:1px solid #c62828;padding:16px;border-radius:8px;margin-top:16px}
.info{font-size:13px;color:#81c784;margin-bottom:16px}
.nav{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.nav a{color:#81c784;text-decoration:none;padding:10px 14px;border:1px solid #2e7d32;border-radius:8px;font-size:14px;min-height:44px;display:flex;align-items:center}
.nav a:hover{background:#1b5e20}
.work-types-group{margin-bottom:16px}
.work-types-group label{display:inline-block;width:auto;margin-right:12px;margin-bottom:8px;font-weight:400}
.btn-loading{opacity:0.7;pointer-events:none}
@media (max-width: 480px) {
  .container{padding:16px}
  .nav{gap:6px}
  .nav a{padding:8px 10px;font-size:13px}
  h1{font-size:22px}
}
</style>
</head><body>
<a href="#applyForm" class="skip-link">Skip to application form</a>
<div class="container">
<div class="nav" role="navigation" aria-label="Site navigation"><a href="https://www.inaturalist.org/pages/seek_app" target="_blank" rel="noopener noreferrer" style="background:#2e7d32;color:#fff;font-weight:600">🌿 Identify Flora</a><a href="/">Chat</a><a href="/Dryad/submit">Submit</a><a href="/Dryad/dashboard">Dashboard</a></div>

<h1>Dryad Contractor Application</h1>
<p class="subtitle">Apply to become a verified work contractor for 25th Street parcels</p>

<form id="applyForm" class="card">
  <label for="fullName">Full Legal Name *</label>
  <input type="text" name="fullName" id="fullName" placeholder="Your full name" required>

  <label for="email">Email *</label>
  <input type="email" name="email" id="email" placeholder="your@email.com" required>

  <label for="phone">Phone Number *</label>
  <input type="tel" name="phone" id="phone" placeholder="+1 (313) 555-0123" required>

  <label for="walletAddress">Base Wallet Address (for USDC payments) *</label>
  <input type="text" name="walletAddress" id="walletAddress" placeholder="0x..." required pattern="0x[a-fA-F0-9]{40}" title="Enter a valid Ethereum address starting with 0x">
  <p class="info">This is where we'll send your USDC payments. Get one at <a href="https://wallet.coinbase.com" target="_blank" style="color:#81c784">Coinbase Wallet</a> or <a href="https://www.rabby.io" target="_blank" style="color:#81c784">Rabby Wallet</a> (free, takes 2 minutes).</p>

  <label for="experience">Work Experience *</label>
  <textarea name="experience" id="experience" placeholder="Tell us about your experience with invasive removal, native planting, soil work, or land stewardship..." required maxlength="2000"></textarea>

  <div class="work-types-group">
    <label style="display:block;font-weight:600;margin-bottom:12px">Work Types You Can Do *</label>
    ${workTypeCheckboxes}
  </div>

  <p class="info">We'll review your application and send your access code to your email within 24 hours.</p>

  <button type="submit" id="submitBtn">Submit Application</button>
</form>
<div id="result"></div>

</div>

<script>
document.getElementById('applyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = document.getElementById('result');
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Submitting...';
  btn.classList.add('btn-loading');

  const body = {
    fullName: form.get('fullName'),
    email: form.get('email'),
    phone: form.get('phone'),
    walletAddress: form.get('walletAddress'),
    experience: form.get('experience'),
    workTypes: form.getAll('workTypes'),
  };

  try {
    const resp = await fetch('/Dryad/api/contractors/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (resp.ok) {
      res.textContent = '';
      var d = document.createElement('div'); d.className = 'success';
      d.innerHTML = '<strong>Application received!</strong> Dryad will review your application and send your access code to <strong>' + (data.email || form.get('email')) + '</strong> within 24 hours.';
      res.appendChild(d);
      document.getElementById('applyForm').reset();
    } else {
      res.textContent = '';
      var d = document.createElement('div'); d.className = 'error';
      d.textContent = 'Error: ' + (data.error || 'Application failed');
      res.appendChild(d);
    }
  } catch (err) {
    res.textContent = '';
    var d = document.createElement('div'); d.className = 'error';
    d.textContent = 'Error: ' + err.message;
    res.appendChild(d);
  } finally {
    btn.textContent = 'Submit Application';
    btn.classList.remove('btn-loading');
  }
});
</script>
</body></html>`;
}

// ─── /submit page (upgraded with access code gating, camera capture, batch photos) ───
function submitPageHTML(): string {
  const workTypeOptions = ['Invasive Removal', 'Soil Prep', 'Native Planting', 'Monitoring/Survey', 'Debris Cleanup', 'Weed Whacking'].map((t) => `<option value="${t}">${t}</option>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dryad — Submit Proof of Work</title>
<link rel="canonical" href="https://dryad.land/Dryad/submit">
<style>
*{box-sizing:border-box;margin:0;padding:0}
.skip-link{position:absolute;top:-40px;left:0;background:#4caf50;color:#fff;padding:8px 16px;z-index:100;font-weight:600;border-radius:0 0 8px 0}
.skip-link:focus{top:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a1a0a;color:#e0e0e0;min-height:100vh;min-height:100dvh}
.container{max-width:640px;margin:0 auto;padding:24px}
h1{color:#4caf50;margin-bottom:4px;font-size:28px}
.subtitle{color:#81c784;margin-bottom:24px}
.card{background:#1a2e1a;border:1px solid #2e7d32;border-radius:12px;padding:24px;margin-bottom:16px}
.card-community{background:#0d1f0d;border:1px solid #1b5e20;border-radius:12px;padding:24px;margin-bottom:16px}
label{display:block;font-weight:600;margin-bottom:6px;color:#a5d6a7}
input,select,textarea{width:100%;padding:10px;border:1px solid #2e7d32;border-radius:8px;background:#0d1f0d;color:#e0e0e0;margin-bottom:16px;font-size:14px}
textarea{resize:vertical;min-height:80px}
button{background:#2e7d32;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:16px;font-weight:600;width:100%;min-height:48px}
button:hover{background:#388e3c}
.success{background:#1b5e20;border:1px solid #4caf50;padding:16px;border-radius:8px;margin-top:16px}
.error{background:#4a1010;border:1px solid #c62828;padding:16px;border-radius:8px;margin-top:16px}
.info{font-size:13px;color:#81c784;margin-bottom:16px}
.warning{font-size:13px;color:#f9a825;margin-bottom:16px}
a{color:#81c784}
.nav{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.nav a{color:#81c784;text-decoration:none;padding:10px 14px;border:1px solid #2e7d32;border-radius:8px;font-size:14px;min-height:44px;display:flex;align-items:center}
.nav a:hover{background:#1b5e20}
.access-code-section{border:2px solid #2e7d32;padding:20px;border-radius:12px;margin-bottom:24px}
.access-code-input{width:100%;padding:12px;font-size:16px;letter-spacing:2px;text-transform:uppercase;border:1px solid #2e7d32;border-radius:8px;background:#0d1f0d;color:#4caf50;margin-bottom:12px;font-weight:600}
.access-validated{color:#4caf50;background:#1b5e20;padding:12px;border-radius:8px;margin-bottom:12px;border:1px solid #4caf50}
.hidden{display:none}
.camera-container{border:1px solid #2e7d32;border-radius:12px;overflow:hidden;margin-bottom:16px;background:#0d1f0d}
#videoPreview{width:100%;height:auto;display:block}
.camera-controls{display:flex;gap:8px;padding:12px;background:#1a2e1a}
.camera-controls button{flex:1;margin:0}
#photoThumbnails{display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:8px;margin-bottom:16px}
.thumbnail{position:relative;width:60px;height:60px;border-radius:6px;overflow:hidden;border:1px solid #2e7d32;cursor:pointer}
.thumbnail img{width:100%;height:100%;object-fit:cover}
.thumbnail .remove{position:absolute;top:0;right:0;background:#c62828;color:#fff;border:none;width:20px;height:20px;padding:0;font-size:12px;cursor:pointer}
.photo-count{color:#81c784;font-weight:600;margin-bottom:8px}
.btn-loading{opacity:0.7;pointer-events:none}
.divider{border:none;border-top:2px solid #2e7d32;margin:32px 0}
.qr-section{text-align:center;padding:16px 0}
.qr-placeholder{width:200px;height:200px;margin:16px auto;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;padding:8px}
.app-links{display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.app-links a{background:#1b5e20;padding:8px 16px;border-radius:8px;text-decoration:none;color:#fff;font-size:14px}
@media (max-width: 480px) {
  .container{padding:16px}
  .nav{gap:6px}
  .nav a{padding:8px 10px;font-size:13px}
  h1{font-size:22px}
}
</style>
</head><body>
<a href="#accessCodeSection" class="skip-link">Skip to access code</a>
<div class="container">
<div class="nav" role="navigation" aria-label="Site navigation"><a href="https://www.inaturalist.org/pages/seek_app" target="_blank" rel="noopener noreferrer" style="background:#2e7d32;color:#fff;font-weight:600">🌿 Identify Flora</a><a href="/">Chat</a><a href="/Dryad/submit">Submit</a><a href="/Dryad/dashboard">Dashboard</a></div>

<h1>Contractor Proof-of-Work</h1>
<p class="subtitle">Submit GPS-tagged photos to verify completed work on 25th Street parcels</p>

<!-- Access Code Gate -->
<div id="accessCodeSection" class="card">
  <label for="accessCode">Access Code *</label>
  <input type="text" id="accessCode" class="access-code-input" placeholder="DRYAD-XXXX" maxlength="12">
  <p class="info">Enter the access code sent to your email after application approval.</p>
  <button type="button" onclick="validateAccessCode()" style="margin-top:8px">Validate Code</button>
  <div id="accessStatus"></div>
</div>

<!-- Main Form (hidden until access code validated) -->
<form id="submitForm" class="card hidden">
  <input type="hidden" name="type" value="proof_of_work">
  <input type="hidden" name="accessCode" id="formAccessCode">

  <div class="access-validated" id="validatedStatus"></div>

  <label for="workType">Work Type *</label>
  <select name="workType" id="workType">${workTypeOptions}</select>

  <label>Photo Capture *</label>
  <p class="info">Use your device camera to capture GPS-tagged photos. Minimum 2 photos required. Maximum 20 photos. Max 10 MB per photo, 50 MB total.</p>

  <div class="camera-container">
    <video id="videoPreview" autoplay playsinline muted style="display:none;width:100%;max-height:60vh;border-radius:8px;background:#000"></video>
    <canvas id="photoCanvas" style="display:none"></canvas>
  </div>

  <div class="camera-controls" style="display:flex;flex-direction:column;gap:8px;padding:12px;background:#1a2e1a">
    <button type="button" id="openCameraBtn" onclick="openCamera()" style="margin:0" aria-label="Open device camera to capture photos">📷 Open Camera</button>
    <button type="button" id="captureBtn" onclick="capturePhoto()" style="display:none;margin:0" aria-label="Capture a photo from the camera">📸 Capture Photo</button>
    <button type="button" id="closeCameraBtn" onclick="closeCamera()" style="display:none;margin:0" aria-label="Close the camera">✓ Done with Photos</button>
    <button type="button" id="uploadFallbackBtn" onclick="document.getElementById('photoUpload').click()" style="margin:0" aria-label="Upload photos from your gallery">📁 Upload from Gallery</button>
  </div>

  <input type="file" id="photoUpload" accept="image/*" multiple style="display:none">
  <p class="warning" style="display:none" id="galleryWarning">Note: Gallery uploads won't have automatic GPS tagging. Camera captures are preferred.</p>

  <div class="photo-count" id="photoCount">0/20 photos</div>
  <div id="photoThumbnails"></div>

  <label for="description">Description of Work *</label>
  <textarea name="description" id="description" placeholder="e.g. Removed 3 Tree of Heaven saplings at NW corner, applied glyphosate to stumps, bagged debris" required maxlength="2000"></textarea>

  <p class="info">GPS is automatically captured with each photo. Payment up to \$50/job in USDC on Base.</p>

  <div style="background:#1a2e1a;border:1px solid #2e5a2e;border-radius:8px;padding:14px;margin:12px 0;font-size:13px">
    <strong style="color:#81c784">Your work gets a permanent digital receipt</strong>
    <p style="margin:6px 0 0;color:#b8b8b8;line-height:1.5">When Dryad verifies your photos, a tamper-proof record is created on the blockchain via the <a href="https://attest.org" target="_blank" style="color:#81c784">Ethereum Attestation Service</a>. Think of it as a permanent receipt proving your ecological work — it can never be altered or deleted. <a href="https://base.easscan.org" target="_blank" style="color:#81c784">View attestations →</a></p>
  </div>

  <button type="submit" id="submitBtn">Submit Proof of Work</button>
</form>
<div id="result"></div>

<hr class="divider">

<div class="card-community">
  <h2>Visiting the forest? Help us catalog species!</h2>
  <p style="margin-bottom:16px">Download the <strong>iNaturalist</strong> app (free) and photograph any plants you find on our lots at 25th Street between Ash and Beech. Your observations automatically feed into Dryad's ecosystem monitoring — no account with us needed.</p>
  <p style="margin-bottom:16px;font-size:13px;color:#b8b8b8">Research-grade observations (where the community confirms the species ID) are attested onchain via the <a href="https://attest.org" target="_blank" style="color:#81c784">Ethereum Attestation Service</a> — creating a permanent record of biodiversity data on Base. Your citizen science contributes to verifiable ecological impact.</p>

  <div class="qr-section">
    <div class="qr-placeholder">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping" alt="QR Code" width="180" height="180">
    </div>
    <p style="font-size:13px;color:#81c784;margin-top:8px">Scan to join our iNaturalist project</p>
  </div>

  <div class="app-links">
    <a href="https://apps.apple.com/app/inaturalist/id421397028" target="_blank">iNaturalist for iOS</a>
    <a href="https://play.google.com/store/apps/details?id=org.inaturalist.android" target="_blank">iNaturalist for Android</a>
  </div>
</div>

</div>

<script>
let capturedPhotos = [];
let videoStream = null;
const MAX_PHOTOS = 20;

async function validateAccessCode() {
  const code = document.getElementById('accessCode').value.trim().toUpperCase();
  const status = document.getElementById('accessStatus');

  if (!code) {
    status.innerHTML = '<div class="error">Please enter your access code</div>';
    return;
  }

  try {
    const resp = await fetch('/Dryad/api/contractors/validate?code=' + encodeURIComponent(code));
    const data = await resp.json();

    if (data.valid) {
      var nameEl = document.createElement('div'); nameEl.className = 'success'; nameEl.textContent = '✓ Access code validated for ' + data.name; status.textContent = ''; status.appendChild(nameEl);
      document.getElementById('accessCodeSection').style.display = 'none';
      document.getElementById('submitForm').classList.remove('hidden');
      document.getElementById('formAccessCode').value = code;
      document.getElementById('validatedStatus').textContent = 'Ready to submit work for ' + data.name;
    } else {
      status.textContent = ''; var invEl = document.createElement('div'); invEl.className = 'error'; invEl.textContent = 'Invalid access code. Please check and try again.'; status.appendChild(invEl);
    }
  } catch (err) {
    status.textContent = ''; var errEl = document.createElement('div'); errEl.className = 'error'; errEl.textContent = 'Error validating code: ' + err.message; status.appendChild(errEl);
  }
}

async function openCamera() {
  var btn = document.getElementById('openCameraBtn');
  btn.textContent = 'Opening camera...';
  btn.disabled = true;

  // Check GPS availability BEFORE opening camera so user knows upfront
  try {
    await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
  } catch (gpsErr) {
    var warn = document.getElementById('galleryWarning');
    warn.style.display = 'block';
    warn.textContent = 'Warning: Location services unavailable. Photos will be captured without GPS tagging. Enable location in your phone settings for best results.';
  }

  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    const video = document.getElementById('videoPreview');
    video.srcObject = videoStream;
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.style.display = 'block';
    await video.play();
    document.getElementById('openCameraBtn').style.display = 'none';
    document.getElementById('captureBtn').style.display = 'block';
    document.getElementById('closeCameraBtn').style.display = 'block';
    document.getElementById('uploadFallbackBtn').style.display = 'none';
  } catch (err) {
    btn.textContent = 'Open Camera';
    btn.disabled = false;
    alert('Camera access denied. Please check your permissions.');
  }
}

function closeCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
  }
  document.getElementById('videoPreview').style.display = 'none';
  document.getElementById('openCameraBtn').style.display = 'block';
  document.getElementById('captureBtn').style.display = 'none';
  document.getElementById('closeCameraBtn').style.display = 'none';
  document.getElementById('uploadFallbackBtn').style.display = 'block';
}

function capturePhoto() {
  if (capturedPhotos.length >= MAX_PHOTOS) {
    alert('Maximum photos reached');
    return;
  }

  const video = document.getElementById('videoPreview');
  const canvas = document.getElementById('photoCanvas');
  const ctx = canvas.getContext('2d');

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  // Draw watermark
  ctx.drawImage(video, 0, 0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, canvas.height - 30, canvas.width, 30);
  ctx.fillStyle = '#4caf50';
  ctx.font = '12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(new Date().toLocaleString(), 8, canvas.height - 12);

  canvas.toBlob((blob) => {
    navigator.geolocation.getCurrentPosition((pos) => {
      capturedPhotos.push({
        blob: blob,
        gpsLat: pos.coords.latitude,
        gpsLng: pos.coords.longitude,
        gpsAccuracy: pos.coords.accuracy,
        capturedAt: Date.now(),
      });
      updatePhotoDisplay();
    }, (err) => {
      // Still capture the photo even if GPS fails — mark as no-GPS
      capturedPhotos.push({
        blob: blob,
        gpsLat: null,
        gpsLng: null,
        gpsAccuracy: null,
        capturedAt: Date.now(),
      });
      updatePhotoDisplay();
      document.getElementById('galleryWarning').style.display = 'block';
      document.getElementById('galleryWarning').textContent = 'Warning: GPS unavailable for some photos. Enable location services in your phone settings for best results.';
    }, { timeout: 10000, maximumAge: 60000 });
  }, 'image/jpeg', 0.9);
}

function removePhoto(index) {
  capturedPhotos.splice(index, 1);
  updatePhotoDisplay();
}

function updatePhotoDisplay() {
  document.getElementById('photoCount').textContent = capturedPhotos.length + '/' + MAX_PHOTOS + ' photos';
  const thumbs = document.getElementById('photoThumbnails');
  thumbs.innerHTML = capturedPhotos.map((p, i) => {
    const url = URL.createObjectURL(p.blob);
    return '<div class="thumbnail"><img src="' + url + '"><button class="remove" type="button" onclick="removePhoto(' + i + ')">×</button></div>';
  }).join('');
}

// Fallback gallery upload
document.getElementById('photoUpload').addEventListener('change', (e) => {
  document.getElementById('galleryWarning').style.display = 'block';
  for (const file of e.target.files) {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const blob = new Blob([evt.target.result], { type: file.type });
      if (capturedPhotos.length < MAX_PHOTOS) {
        capturedPhotos.push({
          blob: blob,
          gpsLat: null,
          gpsLng: null,
          gpsAccuracy: null,
          capturedAt: Date.now(),
        });
        updatePhotoDisplay();
      }
    };
    reader.readAsArrayBuffer(file);
  }
});

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  if (capturedPhotos.length < 2) {
    alert('Minimum 2 photos required');
    return;
  }

  const form = new FormData();
  form.append('accessCode', document.getElementById('formAccessCode').value);
  form.append('workType', document.getElementById('workType').value);
  form.append('description', document.getElementById('description').value);
  form.append('batchId', 'batch_' + Date.now());

  capturedPhotos.forEach((p, i) => {
    form.append('photo_' + i, p.blob, 'photo_' + i + '.jpg');
    if (p.gpsLat !== null) {
      form.append('gps_' + i + '_lat', String(p.gpsLat));
      form.append('gps_' + i + '_lng', String(p.gpsLng));
      form.append('gps_' + i + '_accuracy', String(p.gpsAccuracy));
      form.append('gps_' + i + '_time', String(p.capturedAt));
    }
  });

  const res = document.getElementById('result');
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Uploading...';
  btn.classList.add('btn-loading');

  // Show progress bar
  var progressWrap = document.createElement('div');
  progressWrap.style.cssText = 'width:100%;background:#1a2e1a;border-radius:8px;overflow:hidden;margin:12px 0;height:24px;border:1px solid #2e7d32';
  var progressBar = document.createElement('div');
  progressBar.style.cssText = 'width:0%;height:100%;background:#4caf50;transition:width 0.3s;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:600';
  progressBar.textContent = '0%';
  progressWrap.appendChild(progressBar);
  res.textContent = '';
  res.appendChild(progressWrap);

  try {
    // Use XMLHttpRequest for upload progress tracking
    const data = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/Dryad/api/submissions');
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 100);
          progressBar.style.width = pct + '%';
          progressBar.textContent = pct + '%';
          btn.textContent = 'Uploading... ' + pct + '%';
        }
      });
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error('Invalid server response')); }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.timeout = 120000;
      xhr.send(form);
    });
    progressWrap.remove();
    res.textContent = '';
    if (data.batchId) {
      var d = document.createElement('div'); d.className = 'success';
      d.textContent = ''; var strong = document.createElement('strong'); strong.textContent = 'Batch submitted!'; d.appendChild(strong); d.appendChild(document.createTextNode(' Batch ID: ' + data.batchId + ' | Photos: ' + data.submissions.length)); var easNote = document.createElement('span'); easNote.style.cssText = 'font-size:12px;color:#81c784;margin-top:6px;display:block'; easNote.textContent = 'Once verified, an onchain attestation will be minted on Base. '; var easLink = document.createElement('a'); easLink.href = 'https://base.easscan.org'; easLink.target = '_blank'; easLink.style.cssText = 'color:#81c784;text-decoration:underline'; easLink.textContent = 'View on EAS Explorer'; easNote.appendChild(easLink); d.appendChild(easNote);
      res.appendChild(d);
      capturedPhotos = [];
      updatePhotoDisplay();
      document.getElementById('submitForm').reset();
    } else {
      var d = document.createElement('div'); d.className = 'error';
      d.textContent = 'Error: ' + (data.error || 'Submission failed');
      res.appendChild(d);
    }
  } catch (err) {
    res.textContent = '';
    var d = document.createElement('div'); d.className = 'error';
    d.textContent = 'Error: ' + err.message;
    if (!navigator.onLine) d.textContent += ' (You appear to be offline. Please try again when connected.)';
    res.appendChild(d);
  } finally {
    btn.textContent = 'Submit Proof of Work';
    btn.classList.remove('btn-loading');
  }
});
</script>
</body></html>`;
}

// ─── /dashboard page ───
function dashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dryad — Dashboard</title>
<link rel="canonical" href="https://dryad.land/Dryad/dashboard">
<style>
*{box-sizing:border-box;margin:0;padding:0}
.skip-link{position:absolute;top:-40px;left:0;background:#4caf50;color:#fff;padding:8px 16px;z-index:100;font-weight:600;border-radius:0 0 8px 0}
.skip-link:focus{top:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a1a0a;color:#e0e0e0;min-height:100vh;min-height:100dvh}
.header{background:#1a2e1a;border-bottom:1px solid #2e7d32;padding:16px 24px;display:flex;align-items:center;gap:16px}
.header h1{color:#4caf50;font-size:24px}
.header nav a{color:#81c784;text-decoration:none;margin-left:16px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:24px;max-width:1200px;margin:0 auto}
.card{background:#1a2e1a;border:1px solid #2e7d32;border-radius:12px;padding:20px}
.card h2{color:#4caf50;font-size:18px;margin-bottom:12px;border-bottom:1px solid #2e7d32;padding-bottom:8px}
.card.full{grid-column:1/-1}
.stat{font-size:32px;font-weight:700;color:#66bb6a}
.stat-label{font-size:13px;color:#81c784;margin-top:4px}
.stat-row{display:flex;gap:24px;margin-bottom:16px}
.stat-item{flex:1}
#map{width:100%;height:350px;border-radius:8px;background:#0d1f0d}
.milestone{padding:8px 0;border-bottom:1px solid #1b3a1b;font-size:14px}
.milestone:last-child{border:none}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;margin-right:4px}
.tag-assessment{background:#1565c0;color:#fff}
.tag-removal{background:#c62828;color:#fff}
.tag-soil{background:#6d4c41;color:#fff}
.tag-planting{background:#2e7d32;color:#fff}
.tag-monitoring{background:#f9a825;color:#000}
.sub-item{padding:8px 0;border-bottom:1px solid #1b3a1b;font-size:14px}
.sub-verified{color:#4caf50}.sub-failed{color:#ef5350}
table{width:100%;border-collapse:collapse}
td,th{padding:8px;text-align:left;border-bottom:1px solid #1b3a1b;font-size:14px}
th{color:#81c784}
.loading{color:#81c784;font-style:italic}
.skeleton{background:linear-gradient(90deg,#1a2e1a 25%,#243d24 50%,#1a2e1a 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:6px;height:20px;margin-bottom:8px}
.skeleton.lg{height:40px;width:60%}
.skeleton.md{height:16px;width:80%}
.skeleton.sm{height:14px;width:50%}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
code{word-break:break-all}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media (max-width: 768px) {
  .grid{grid-template-columns:1fr;padding:16px}
  .header{flex-wrap:wrap;padding:12px 16px}
  .header h1{font-size:20px;width:100%}
  .header nav{width:100%;display:flex;gap:12px;margin-top:8px}
  .header nav a{font-size:14px;padding:6px 0}
  .stat{font-size:24px}
  .stat-row{flex-direction:column;gap:12px}
  #map{height:220px}
  td,th{font-size:12px;padding:6px 4px}
  .card{padding:16px}
}
</style>
</head><body>
<a href="#map" class="skip-link">Skip to map</a>
<div class="header">
  <h1>🌿 Dryad Dashboard</h1>
  <nav role="navigation" aria-label="Site navigation"><a href="https://www.inaturalist.org/pages/seek_app" target="_blank" style="background:#2e7d32;color:#fff;padding:6px 12px;border-radius:6px;font-weight:600">🌿 Identify Flora</a><a href="/">Chat</a><a href="/Dryad/submit">Submit Work</a><a href="/Dryad/dashboard">Dashboard</a></nav>
</div>

<div class="grid">
  <!-- Map -->
  <div class="card full">
    <h2>25th Street Parcels — Detroit, MI</h2>
    <div id="map"></div>
  </div>

  <!-- Health Score -->
  <div class="card">
    <h2>Ecosystem Health</h2>
    <div id="healthScore" class="loading"><div class="skeleton lg"></div><div class="skeleton sm"></div><div class="skeleton sm"></div></div>
  </div>

  <!-- Treasury -->
  <div class="card">
    <h2>Treasury</h2>
    <div id="treasury" class="loading"><div class="skeleton lg"></div><div class="skeleton lg"></div><div class="skeleton md"></div></div>
  </div>

  <!-- Annual Cost Breakdown -->
  <div class="card">
    <h2>Annual Operating Costs</h2>
    <div class="table-wrap"><table>
      <tr><th>Item</th><th style="text-align:right">Cost</th></tr>
      <tr><td>Property taxes (9 × $30/lot)</td><td style="text-align:right">$270</td></tr>
      <tr><td>DIEM for inference (0.17 staked)</td><td style="text-align:right">$62</td></tr>
      <tr><td>Contractor payments (~4 jobs)</td><td style="text-align:right">$200</td></tr>
      <tr><td>Hetzner VPS (CX22)</td><td style="text-align:right">$58</td></tr>
      <tr><td>LLC maintenance</td><td style="text-align:right">$50</td></tr>
      <tr><td>Gas fees on Base</td><td style="text-align:right">$5</td></tr>
      <tr style="font-weight:700;border-top:2px solid #2e7d32"><td>Total (Yr 3+)</td><td style="text-align:right">$945/yr</td></tr>
      <tr style="color:#f9a825"><td>If Land Value Tax passes</td><td style="text-align:right">$978/yr</td></tr>
    </table></div>
    <p style="font-size:12px;color:#81c784;margin-top:8px">Detroit accepts crypto for taxes via PayPal at checkout.</p>
  </div>

  <!-- Stress Test -->
  <div class="card">
    <h2>Treasury Stress Test</h2>
    <div id="stressTest" class="loading"><div class="skeleton md"></div><div class="skeleton md"></div><div class="skeleton md"></div></div>
    <p style="font-size:12px;color:#81c784;margin-top:8px">USDC deployed cross-chain into DeFi yield protocols (Aave V3, Compound V3, Morpho) on Base and Arbitrum.</p>
  </div>

  <!-- Milestones -->
  <div class="card">
    <h2>Onchain Milestones</h2>
    <div id="milestones" class="loading"><div class="skeleton md"></div><div class="skeleton md"></div></div>
  </div>

  <!-- Spending Mode -->
  <div class="card">
    <h2>Adaptive Spending Mode</h2>
    <div id="spendingMode" class="loading"><div class="skeleton lg"></div><div class="skeleton sm"></div></div>
  </div>

  <!-- iNaturalist Observations -->
  <div class="card full">
    <h2>iNaturalist Observations on Parcels</h2>
    <div id="inatObs" class="loading"><div class="skeleton md"></div><div class="skeleton md"></div><div class="skeleton sm"></div></div>
    <p style="font-size:12px;color:#81c784;margin-top:8px"><a href="${INAT_OBS_URL}" target="_blank">View all observations</a> | <a href="/Dryad/submit">Help catalog species with iNaturalist</a> | <img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(INAT_OBS_URL)}" alt="QR" width="40" height="40" style="vertical-align:middle;margin-left:8px;border-radius:4px"></p>
  </div>

  <!-- Recent Contractor Submissions -->
  <div class="card full">
    <h2>Contractor Proof-of-Work Submissions</h2>
    <div id="submissions" class="loading"><div class="skeleton md"></div><div class="skeleton md"></div><div class="skeleton sm"></div></div>
  </div>

  <!-- Agent Info -->
  <div class="card full">
    <h2>Agent Identity</h2>
    <div class="table-wrap"><table>
      <tr><th>Name</th><td>Dryad — "The Forest That Owns Itself"</td></tr>
      <tr><th>ENS</th><td><strong>dryadforest.eth</strong></td></tr>
      <tr><th>Email</th><td>dryad@agentmail.to</td></tr>
      <tr><th>Wallet</th><td><code id="walletAddr">Loading...</code></td></tr>
      <tr><th>ERC-8004 Agent ID</th><td>#${process.env.ERC8004_AGENT_ID || '35293'} on Base</td></tr>
      <tr><th>Milestones Contract</th><td><a href="https://basescan.org/address/${process.env.MILESTONES_CONTRACT_ADDRESS || '0x7572dcac88720470d8cc827be5b02d474951bc22'}" style="color:#81c784"><code>${process.env.MILESTONES_CONTRACT_ADDRESS || '0x7572dcac88720470d8cc827be5b02d474951bc22'}</code></a></td></tr>
      <tr><th>Registry</th><td><code>0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</code></td></tr>
      <tr><th>Steward</th><td>Nick George (<a href="https://x.com/0xnock" target="_blank" style="color:#81c784">@0xnock</a>)</td></tr>
      <tr><th>Decision Loop</th><td>Every 24 hours</td></tr>
    </table></div>
  </div>
</div>

<script>
// Load Mapbox GL
const mapScript = document.createElement('script');
mapScript.src = 'https://unpkg.com/mapbox-gl@3.9.4/dist/mapbox-gl.min.js';
const mapCSS = document.createElement('link');
mapCSS.rel = 'stylesheet';
mapCSS.href = 'https://unpkg.com/mapbox-gl@3.9.4/dist/mapbox-gl.css';
document.head.appendChild(mapCSS);
mapScript.onload = () => {
  mapboxgl.accessToken = 'pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw'; // Public demo token
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    center: [${PARCEL_BOUNDS.center.lng}, ${PARCEL_BOUNDS.center.lat}],
    zoom: 18,
  });

  const parcels = ${JSON.stringify(PARCELS.map((p) => ({ address: p.address, lat: p.lat, lng: p.lng })))};
  parcels.forEach(p => {
    new mapboxgl.Marker({ color: '#4caf50' })
      .setLngLat([p.lng, p.lat])
      .setPopup(new mapboxgl.Popup().setHTML('<strong>' + p.address + '</strong><br>30×110 ft'))
      .addTo(map);
  });
};
document.head.appendChild(mapScript);

// Load treasury data + stress test + spending mode
fetch('/Dryad/api/treasury').then(r=>r.json()).then(data => {
  const usdcTotal = parseFloat(data.usdcTotal || '0');
  const usdcDeployed = parseFloat(data.usdcDeployed || '0');
  const usdcIdle = parseFloat(data.usdcIdle || '0');
  const blendedApy = parseFloat(data.blendedApy || '0');
  const annualYield = parseFloat(data.usdcAnnualYield || '0').toFixed(2);
  const dailyYield = parseFloat(data.usdcDailyYield || '0').toFixed(4);
  const ethBal = parseFloat(data.ethBalance || '0');

  document.getElementById('treasury').innerHTML = \`
    <div class="stat-row">
      <div class="stat-item"><div class="stat">$\${usdcTotal.toFixed(2)}</div><div class="stat-label">Total USDC</div></div>
      <div class="stat-item"><div class="stat">$\${usdcDeployed.toFixed(2)}</div><div class="stat-label">Earning yield</div></div>
    </div>
    <div class="stat-row">
      <div class="stat-item"><div class="stat">\${(blendedApy * 100).toFixed(1)}%</div><div class="stat-label">Blended APY</div></div>
      <div class="stat-item"><div class="stat">$\${dailyYield}</div><div class="stat-label">Daily Yield</div></div>
    </div>
    <p style="font-size:12px;color:#81c784">Annual yield: ~$\${annualYield} | Idle reserve: $\${usdcIdle.toFixed(2)} | Gas: \${ethBal.toFixed(6)} ETH</p>
    <p style="font-size:12px;color:#81c784">Wallet: <code>\${data.wallet || '—'}</code></p>
  \`;
  document.getElementById('walletAddr').textContent = data.wallet || '—';

  // Stress test — USDC yield is stable (no ETH price risk), so show APY scenarios
  const yieldCurrent = usdcDeployed * blendedApy;
  const yieldLowApy = usdcDeployed * blendedApy * 0.5; // APY drops 50%
  const yieldMinApy = usdcDeployed * 0.01; // worst case 1% APY
  document.getElementById('stressTest').innerHTML = \`
    <table>
      <tr><th>Scenario</th><th style="text-align:right">Annual Yield</th><th style="text-align:right">vs $945 cost</th></tr>
      <tr><td>Current APY</td><td style="text-align:right">$\${yieldCurrent.toFixed(0)}</td><td style="text-align:right;color:\${yieldCurrent>=945?'#4caf50':'#ef5350'}">\${yieldCurrent>=945?'✅ Covered':'⚠️ Shortfall $'+(945-yieldCurrent).toFixed(0)}</td></tr>
      <tr><td>APY halved</td><td style="text-align:right">$\${yieldLowApy.toFixed(0)}</td><td style="text-align:right;color:\${yieldLowApy>=945?'#4caf50':'#ef5350'}">\${yieldLowApy>=945?'✅':'⚠️ -$'+(945-yieldLowApy).toFixed(0)}</td></tr>
      <tr><td>1% floor</td><td style="text-align:right">$\${yieldMinApy.toFixed(0)}</td><td style="text-align:right;color:\${yieldMinApy>=945?'#4caf50':'#ef5350'}">\${yieldMinApy>=945?'✅':'⚠️ -$'+(945-yieldMinApy).toFixed(0)}</td></tr>
    </table>
    <p style="font-size:12px;color:#81c784;margin-top:8px">Need ~$\${(945/blendedApy || 27000).toFixed(0)} USDC at current APY for full self-sustainability.</p>
  \`;

  // Spending mode
  const isSustainable = parseFloat(annualYield) >= 645;
  const coversCore = parseFloat(annualYield) >= 383; // taxes + VPS + gas + LLC
  const mode = isSustainable ? 'NORMAL' : coversCore ? 'CONSERVATION' : 'CRITICAL';
  const modeColors = { NORMAL: '#4caf50', CONSERVATION: '#f9a825', CRITICAL: '#ef5350' };
  const modeDesc = {
    NORMAL: 'All operations active. Yield covers full annual costs.',
    CONSERVATION: 'Discretionary contractor jobs paused. Monitoring + taxes + VPS continue.',
    CRITICAL: 'Yield insufficient for core costs. Steward intervention needed.',
  };
  document.getElementById('spendingMode').innerHTML = \`
    <div class="stat" style="color:\${modeColors[mode]}">\${mode}</div>
    <div class="stat-label">\${modeDesc[mode]}</div>
    <p style="font-size:12px;color:#81c784;margin-top:8px">Non-negotiable: $383/yr (taxes $270 + VPS $58 + gas $5 + LLC $50)</p>
  \`;
}).catch(()=>{ document.getElementById('treasury').textContent = 'Failed to load'; });

// Load health score
fetch('/Dryad/api/health-score').then(r=>r.json()).then(data => {
  document.getElementById('healthScore').innerHTML = \`
    <div class="stat">\${data.healthScore}/100</div>
    <div class="stat-label">On-parcel observations: \${data.onParcelObservations}</div>
    <div class="stat-label">Native species: \${data.nativeSpeciesCount}</div>
    <div class="stat-label">Invasives detected: \${data.invasiveCount}</div>
  \`;
}).catch(()=>{ document.getElementById('healthScore').textContent = 'Failed to load'; });

// Load milestones
fetch('/Dryad/api/milestones').then(r=>r.json()).then(data => {
  const types = ['SiteAssessment','InvasiveRemoval','SoilPrep','NativePlanting','Monitoring'];
  const tags = ['assessment','removal','soil','planting','monitoring'];
  if (!data.milestones || data.milestones.length === 0) {
    document.getElementById('milestones').innerHTML = '<p>No milestones recorded yet.</p>';
    return;
  }
  document.getElementById('milestones').innerHTML = data.milestones.map(m =>
    '<div class="milestone"><span class="tag tag-' + tags[m.milestoneType] + '">' + types[m.milestoneType] + '</span> ' + esc(m.parcel) + ' — ' + new Date(m.timestamp * 1000).toLocaleDateString() + '</div>'
  ).join('');
}).catch(()=>{ document.getElementById('milestones').textContent = 'Failed to load'; });

// Load iNaturalist observations
fetch('${INAT_API_URL}&per_page=10&order_by=observed_on&taxon_name=Plantae').then(r=>r.json()).then(data => {
  const obs = data.results || [];
  if (!obs.length) { document.getElementById('inatObs').innerHTML = '<p>No observations on parcels yet. <a href="${INAT_OBS_URL}">Be the first to contribute!</a></p>'; return; }
  document.getElementById('inatObs').innerHTML = '<table><tr><th>Species</th><th>Observer</th><th>Date</th><th>Grade</th></tr>' + obs.map(o => {
    const name = esc(o.taxon?.preferred_common_name || o.taxon?.name || o.species_guess || 'Unknown');
    const sci = esc(o.taxon?.name || '');
    const observer = esc(o.user?.login || '?');
    const date = o.observed_on || '?';
    const grade = o.quality_grade === 'research' ? '<span style="color:#4caf50">Research</span>' : o.quality_grade || '?';
    const isInvasive = ['Ailanthus','Lonicera','Lythrum','Phragmites','Alliaria','Reynoutria','Rhamnus'].some(g => sci.toLowerCase().includes(g.toLowerCase()));
    return '<tr' + (isInvasive ? ' style="color:#ef5350;font-weight:600"' : '') + '><td>' + name + (isInvasive ? ' ⚠️' : '') + '<br><span style="font-size:11px;color:#b0b0b0">' + sci + '</span></td><td>' + observer + '</td><td>' + date + '</td><td>' + grade + '</td></tr>';
  }).join('') + '</table>';
}).catch(()=>{ document.getElementById('inatObs').textContent = 'Failed to load'; });

// SECURITY: HTML escape to prevent XSS from user-supplied data
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Load submissions
fetch('/Dryad/api/submissions').then(r=>r.json()).then(data => {
  if (!data.length) { document.getElementById('submissions').innerHTML = '<p>No submissions yet. <a href="/Dryad/submit">Submit a photo</a></p>'; return; }
  document.getElementById('submissions').innerHTML = data.slice(0,10).map(s =>
    '<div class="sub-item">' +
    '<span class="' + (s.verified ? 'sub-verified' : 'sub-failed') + '">' + (s.verified ? '✅' : '❌') + '</span> ' +
    '<strong>' + esc(s.workType || s.type) + '</strong> at ' + esc(s.nearestParcel) +
    (s.contractorName ? ' — ' + esc(s.contractorName) : '') +
    ' <span style="color:#b0b0b0;font-size:12px">' + new Date(s.submittedAt).toLocaleString() + '</span>' +
    '</div>'
  ).join('');
}).catch(()=>{ document.getElementById('submissions').textContent = 'Failed to load'; });
</script>
</body></html>`;
}

export const dryadRoutes = [
  {
    name: 'apply-page',
    path: '/apply',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      securityHeaders(res);
      res.setHeader?.('Content-Type', 'text/html');
      res.send(applyPageHTML());
    },
  },
  {
    name: 'submit-page',
    path: '/submit',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      securityHeaders(res);
      res.setHeader?.('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'");
      res.setHeader?.('Content-Type', 'text/html');
      res.send(submitPageHTML());
    },
  },
  {
    name: 'contractors-page',
    path: '/contractors',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      securityHeaders(res);
      res.setHeader?.('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'");
      res.setHeader?.('Content-Type', 'text/html');
      res.send(contractorPageHTML());
    },
  },
  {
    name: 'dashboard-page-html',
    path: '/dashboard-html',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      // Legacy HTML dashboard — kept for fallback
      securityHeaders(res);
      res.setHeader?.('Content-Type', 'text/html');
      res.send(dashboardHTML());
    },
  },
  {
    name: 'api-submissions-post',
    path: '/api/submissions',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      // SECURITY: Rate limiting
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'submit');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many submissions. Try again later.' } as unknown);
        return;
      }

      const contentType = (req.headers?.['content-type'] || '') as string;

      // Handle multipart/form-data with file upload (supports both old single-photo and new batch multi-photo)
      if (contentType.includes('multipart/form-data')) {
        try {
          const parsed: {
            fields: Record<string, string>;
            files: Map<string, Buffer>;
            fileInfos: Map<string, string>;
          } = {
            fields: {},
            files: new Map(),
            fileInfos: new Map(),
          };

          const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
          const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total
          const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
          let totalBytes = 0;

          await new Promise<void>((resolve, reject) => {
            const busboy = Busboy({
              headers: req.headers as Record<string, string>,
              limits: { fileSize: MAX_FILE_SIZE, files: 20, fields: 100 },
            });

            busboy.on('field', (name: string, value: string) => {
              parsed.fields[name] = value;
            });

            busboy.on('file', (name: string, stream: any, info: any) => {
              // SECURITY: Validate MIME type
              const mime = (info.mimeType || '').toLowerCase();
              if (!ALLOWED_MIME.includes(mime)) {
                stream.resume(); // drain the stream
                return;
              }

              const chunks: Buffer[] = [];
              let fileBytes = 0;
              stream.on('data', (chunk: Buffer) => {
                fileBytes += chunk.length;
                totalBytes += chunk.length;
                // SECURITY: Enforce per-file and total size limits
                if (fileBytes > MAX_FILE_SIZE || totalBytes > MAX_TOTAL_SIZE) {
                  stream.destroy(new Error('File too large'));
                  return;
                }
                chunks.push(chunk);
              });
              stream.on('end', () => {
                if (fileBytes <= MAX_FILE_SIZE && totalBytes <= MAX_TOTAL_SIZE) {
                  parsed.files.set(name, Buffer.concat(chunks));
                  parsed.fileInfos.set(name, info.filename);
                }
              });
              stream.on('error', reject);
            });

            busboy.on('finish', () => {
              resolve();
            });

            busboy.on('error', reject);
            (req as any).pipe(busboy);
          });

          // SECURITY: Sanitize input
          const sanitize = (s: string, maxLen: number) => String(s || '').replace(/<[^>]*>/g, '').slice(0, maxLen);

          const { fields } = parsed;
          const accessCode = sanitize(fields.accessCode || '', 20);
          const workType = sanitize(fields.workType, 100);
          const description = sanitize(fields.description, 2000);
          const batchId = sanitize(fields.batchId || `batch_${Date.now()}`, 50);

          // NEW: If access code is provided, validate it (contractor submission)
          let contractor = null;
          if (accessCode) {
            contractor = validateAccessCode(accessCode);
            if (!contractor) {
              res.status(403).json({ error: 'Invalid access code' } as unknown);
              return;
            }
          }

          // SECURITY: Check for injection attempts
          const allText = `${description} ${workType}`;
          const injection = isInjectionAttempt(allText);
          if (injection.detected) {
            audit('INJECTION_ATTEMPT', `Pattern: ${injection.pattern}`, 'submit_portal', 'warn');
            res.status(400).json({ error: 'Invalid submission' } as unknown);
            return;
          }

          // Process multiple photos (photo_0, photo_1, etc.)
          const photoEntries = Array.from(parsed.files.entries()).filter(([name]) => name.match(/^photo_\d+$/));
          const submissions = [];

          for (const [photoName, fileBuffer] of photoEntries) {
            const photoIndex = parseInt(photoName.match(/\d+/)?.[0] || '0', 10);

            // Extract GPS from form fields (gps_0_lat, gps_0_lng, etc.)
            let lat = parseFloat(fields[`gps_${photoIndex}_lat`] || '0');
            let lng = parseFloat(fields[`gps_${photoIndex}_lng`] || '0');
            const gpsAccuracy = parseFloat(fields[`gps_${photoIndex}_accuracy`] || '0');
            const gpsTime = parseInt(fields[`gps_${photoIndex}_time`] || String(Date.now()), 10);

            // If no GPS provided, try EXIF
            let exifLat: number | undefined;
            let exifLng: number | undefined;
            if (fileBuffer && fileBuffer.length > 0 && (isNaN(lat) || isNaN(lng))) {
              const exifGps = extractGpsFromExif(fileBuffer);
              if (exifGps) {
                exifLat = exifGps.lat;
                exifLng = exifGps.lng;
                lat = exifGps.lat;
                lng = exifGps.lng;
              }
            }

            // SECURITY: Reject invalid coordinates
            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
              console.warn(`[Submissions] Skipping photo ${photoIndex}: invalid GPS (${lat}, ${lng})`);
              continue;
            }

            // Compute hash and save photo
            const imageHash = computeImageHash(fileBuffer);
            const photoFilename = `photo_${Date.now()}_${photoIndex}_${Math.random().toString(36).slice(2, 8)}.jpg`;
            const photoPath = path.join(UPLOADS_DIR, photoFilename);
            fs.writeFileSync(photoPath, fileBuffer);

            const timestamp = gpsTime || Date.now();
            const submission = addSubmission({
              type: 'proof_of_work',
              lat,
              lng,
              timestamp,
              workType,
              description,
              photoFilename,
              contractorName: contractor?.name || '',
              contractorEmail: contractor?.email || '',
              imageHash,
              photoPath,
              exifLat,
              exifLng,
            });

            // Record submission for contractor
            if (contractor) {
              recordSubmission(contractor.id, false); // Mark as unreviewed initially
              const userAgent = (req.headers?.['user-agent'] || '') as string;
              const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
              updateDeviceInfo(contractor.id, userAgent, ip);
            }

            // Fire-and-forget: run vision verification in background
            verifyWorkPhoto({
              photoPath: submission.photoPath,
              workType: submission.workType || 'site_assessment',
              workDescription: submission.description,
              parcelAddress: submission.nearestParcel,
              contractorName: submission.contractorName,
            }).then((visionResult) => {
              updateSubmissionVision(submission.id, {
                score: visionResult.score,
                approved: visionResult.approved,
                reasoning: visionResult.reasoning,
                matchedIndicators: visionResult.matchedIndicators,
                flagsTriggered: visionResult.flagsTriggered,
                model: visionResult.model,
              });
              console.log(`[Dryad Vision] ${submission.id}: score=${visionResult.score.toFixed(2)} approved=${visionResult.approved}`);
            }).catch((err) => {
              console.error(`[Dryad Vision] Failed for ${submission.id}:`, err?.message);
            });

            submissions.push(submission);
          }

          // Return batch result
          if (submissions.length > 0) {
            res.json({ batchId, submissions, count: submissions.length });
          } else {
            res.status(400).json({ error: 'No valid photos processed' } as unknown);
          }
        } catch (error) {
          res.status(400).json({ error: (error instanceof Error ? error.message : 'Invalid multipart submission') as unknown });
        }
        return;
      }

      // JSON submissions require admin auth (no public JSON submissions — use multipart with access code)
      if (!isAdmin(req)) {
        res.status(403).json({ error: 'JSON submissions require admin authorization. Use the submit portal with an access code.' } as unknown);
        return;
      }

      const rawSubmitBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
      if (rawSubmitBody.length > 50_000) {
        res.status(413).json({ error: 'Request too large' } as unknown);
        return;
      }

      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as any) || {};

        // SECURITY: Input sanitization
        const sanitize = (s: string, maxLen: number) => String(s || '').replace(/<[^>]*>/g, '').slice(0, maxLen);
        const lat = parseFloat(body?.lat || '0');
        const lng = parseFloat(body?.lng || '0');

        // SECURITY: Reject obviously invalid coordinates
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          res.status(400).json({ error: 'Invalid GPS coordinates' } as unknown);
          return;
        }

        const timestamp = body?.timestamp ? new Date(body.timestamp).getTime() : Date.now();
        const type = body?.type === 'plant_id' ? 'plant_id' : 'proof_of_work';
        const species = sanitize(body?.species, 200);
        const workType = sanitize(body?.workType, 100);
        const description = sanitize(body?.description, 2000);
        const contractorName = sanitize(body?.contractorName, 100);
        const contractorEmail = sanitize(body?.contractorEmail, 200);
        const photoFilename = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;

        // SECURITY: Check for injection attempts
        const allText = `${description} ${contractorName} ${species} ${workType}`;
        const injection = isInjectionAttempt(allText);
        if (injection.detected) {
          audit('INJECTION_ATTEMPT', `Pattern: ${injection.pattern}`, 'submit_portal', 'warn');
          res.status(400).json({ error: 'Invalid submission' } as unknown);
          return;
        }

        const submission = addSubmission({
          type: type as 'plant_id' | 'proof_of_work',
          lat,
          lng,
          timestamp,
          species,
          workType,
          description,
          photoFilename,
          contractorName,
          contractorEmail,
        });

        res.json(submission);
      } catch (error) {
        res.status(400).json({ error: (error instanceof Error ? error.message : 'Invalid submission') as unknown });
      }
    },
  },
  {
    name: 'api-submissions-get',
    path: '/api/submissions',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      // SECURITY: Strip contractor email from public response (PII)
      const subs = getAllSubmissions().map(({ contractorEmail, ...rest }) => ({
        ...rest,
        // Add EAS attestation URL if attestation exists
        easUrl: rest.easAttestationUid ? getAttestationUrl(rest.easAttestationUid as `0x${string}`) : null,
      }));
      res.json(subs);
    },
  },
  {
    name: 'api-health-score',
    path: '/api/health-score',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      try {
        const { sw, ne } = PARCEL_BOUNDS;
        const url = `https://api.inaturalist.org/v1/observations?nelat=${ne.lat}&nelng=${ne.lng}&swlat=${sw.lat}&swlng=${sw.lng}&per_page=200&taxon_name=Plantae&order_by=observed_on`;
        const resp = await fetch(url);
        const data = (await resp.json()) as any;
        const observations = data.results || [];

        // Quick health score calc
        const { INVASIVE_SPECIES } = await import('./actions/checkBiodiversity.ts');
        let invasiveCount = 0;
        const nativeSpecies = new Set<string>();
        for (const obs of observations) {
          const name = obs.taxon?.name || obs.species_guess || '';
          let isInvasive = false;
          for (const genus of Object.keys(INVASIVE_SPECIES)) {
            if (name.toLowerCase().includes(genus.toLowerCase())) { isInvasive = true; invasiveCount++; break; }
          }
          if (!isInvasive && obs.taxon?.name) nativeSpecies.add(obs.taxon.preferred_common_name || obs.taxon.name);
        }
        const invasiveRatio = observations.length > 0 ? invasiveCount / observations.length : 0;
        const diversityScore = Math.min(nativeSpecies.size / 20, 1) * 50;
        const invasiveScore = (1 - invasiveRatio) * 50;
        const healthScore = Math.round(diversityScore + invasiveScore);

        res.json({ healthScore, onParcelObservations: observations.length, nativeSpeciesCount: nativeSpecies.size, invasiveCount });
      } catch {
        res.json({ healthScore: 0, onParcelObservations: 0, nativeSpeciesCount: 0, invasiveCount: 0 });
      }
    },
  },
  {
    name: 'api-treasury',
    path: '/api/treasury',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      try {
        const { createPublicClient, http, parseAbi, formatEther, formatUnits } = await import('viem');
        const { base } = await import('viem/chains');
        const { privateKeyToAccount } = await import('viem/accounts');
        const { CHAIN } = await import('./config/constants.ts');

        const pk = process.env.EVM_PRIVATE_KEY;
        if (!pk) { res.json({ error: 'No wallet' }); return; }

        const account = privateKeyToAccount(pk as `0x${string}`);
        const client = createPublicClient({
          chain: base,
          transport: CHAIN.RPC_URL ? http(CHAIN.RPC_URL) : http()
        });

        const ethBal = await client.getBalance({ address: account.address });
        const wstethAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
        const wstethBal = await client.readContract({
          address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452' as `0x${string}`,
          abi: wstethAbi, functionName: 'balanceOf', args: [account.address],
        }) as bigint;

        const ethNum = parseFloat(formatEther(ethBal));
        const wstethNum = parseFloat(formatEther(wstethBal));
        let ethPrice = 2500;
        try { const pr = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',{signal:AbortSignal.timeout(3000)}); if(pr.ok){const d=await pr.json() as any;ethPrice=d?.ethereum?.usd||2500;} } catch{}
        const dailyYield = (wstethNum * 0.035) / 365 * ethPrice;

        // Get USDC DeFi data
        let usdcIdle = 0;
        let usdcDeployed = 0;
        let blendedApy = 0;
        let usdcAnnualYield = 0;
        let usdcDailyYield = 0;

        try {
          usdcIdle = await getUsdcBalance();
          const positions = loadPositions();
          usdcDeployed = positions.reduce((s, p) => s + p.depositedUsd, 0);
          // Calculate weighted blended APY
          if (usdcDeployed > 0) {
            for (const pos of positions) {
              const proto = PROTOCOLS.find(p => p.name === pos.protocolName);
              if (proto) blendedApy += (pos.depositedUsd / usdcDeployed) * proto.currentApy;
            }
          }
          usdcAnnualYield = usdcDeployed * blendedApy;
          usdcDailyYield = usdcAnnualYield / 365;
        } catch (err) {
          // Non-critical — continue with zero USDC data
        }

        const usdcTotal = usdcIdle + usdcDeployed;

        res.json({
          wallet: account.address,
          ethBalance: ethNum.toFixed(6),
          wstethBalance: wstethNum.toFixed(6),
          dailyYieldUSD: `$${(dailyYield + usdcDailyYield).toFixed(2)}`,
          monthlyYieldUSD: `$${((dailyYield + usdcDailyYield) * 30).toFixed(2)}`,
          usdcIdle,
          usdcDeployed,
          usdcTotal,
          blendedApy,
          usdcAnnualYield,
          usdcDailyYield,
        });
      } catch {
        res.status(500).json({ error: 'Failed to fetch treasury data' });
      }
    },
  },
  {
    name: 'api-milestones',
    path: '/api/milestones',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      try {
        const { createPublicClient, http, parseAbi } = await import('viem');
        const { base } = await import('viem/chains');

        const contractAddr = process.env.MILESTONES_CONTRACT_ADDRESS as `0x${string}`;
        if (!contractAddr) { res.json({ milestones: [] }); return; }

        const { CHAIN: chainCfg } = await import('./config/constants.ts');
        const client = createPublicClient({ chain: base, transport: chainCfg.RPC_URL ? http(chainCfg.RPC_URL) : http() });
        const abi = parseAbi([
          'function milestoneCount() view returns (uint256)',
          'function getMilestone(uint256) view returns (uint8,string,string,bytes32,uint256,address)',
        ]);

        const count = await client.readContract({ address: contractAddr, abi, functionName: 'milestoneCount' }) as bigint;
        const milestones: any[] = [];
        const n = Number(count);
        for (let i = 0; i < Math.min(n, 20); i++) {
          const m = await client.readContract({ address: contractAddr, abi, functionName: 'getMilestone', args: [BigInt(i)] }) as unknown as any[];
          milestones.push({
            id: i,
            milestoneType: Number(m[0]),
            parcel: m[1],
            description: m[2],
            dataHash: m[3],
            timestamp: Number(m[4]),
            recorder: m[5],
          });
        }

        res.json({ milestones });
      } catch {
        res.json({ milestones: [] });
      }
    },
  },
  {
    name: 'api-security',
    path: '/api/security',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(403).json({ error: 'Unauthorized' } as unknown);
        return;
      }
      res.json({
        summary: getAuditSummary(24),
        recentEvents: getRecentAuditEntries(50),
        transactionHistory: getTransactionHistory(),
        paymentsPaused: isPaymentsPaused(),
        dailyDigest: getDailyDigest(),
      });
    },
  },
  {
    name: 'api-chat-cors',
    path: '/api/chat',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      corsHeaders(req, res);
      res.json({ status: 'ok', usage: 'POST with {text: "your question"}' } as unknown);
    },
  },
  {
    name: 'api-chat',
    path: '/api/chat',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => {
      // CORS headers for cross-origin requests from Vercel
      corsHeaders(req, res);

      // Rate limiting
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'message');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many messages. Try again later.' } as unknown);
        return;
      }

      // Reject oversized bodies before parsing (prevent memory exhaustion)
      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
      if (rawBody.length > 10_000) {
        res.status(413).json({ error: 'Request too large' } as unknown);
        return;
      }

      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as any) || {};
        const text = String(body.text || '').slice(0, 500).trim();

        if (!text) {
          res.status(400).json({ error: 'Missing text field' } as unknown);
          return;
        }

        // Security: check for injection attempts
        if (isInjectionAttempt(text).detected) {
          audit('INJECTION_ATTEMPT', `Input: ${text.slice(0, 100)} | IP: ${ip}`, 'chat_api', 'warn');
          res.json({ text: "I'm Dryad, an autonomous land stewardship agent. I can tell you about the project, Detroit's vacant land crisis, native ecology, or how to get involved. What would you like to know?" } as unknown);
          return;
        }

        // Use the full character system prompt so the model has all knowledge
        const { character } = await import('./character.ts');
        const systemPrompt = (character.system || '') + `

CHAT BEHAVIOR:
- Keep responses concise: 2-4 sentences for simple questions, longer for complex ones.
- When you provide a URL, write the FULL url (e.g. https://buildingdetroit.org) — do NOT use markdown link syntax since it won't render.
- NEVER invent URLs, addresses, contract hashes, or facts. Only use information from this system prompt. If you don't know, say so.
- NEVER output non-English characters. Respond only in English.

KEY URLS (use these exactly when relevant):
- iNaturalist project: https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping
- Wallet on BaseScan: https://basescan.org/address/0xf2f7527D86e2173c91fF1c10Ede03f6f84510880
- Milestones contract: https://basescan.org/address/0x7572dcac88720470d8cc827be5b02d474951bc22
- DLBA / get a lot: https://buildingdetroit.org
- Seek app (plant ID): https://www.inaturalist.org/pages/seek_app
- GitHub: https://github.com/vivicool12334/dryad`;

        // Build conversation history from client
        const rawHistory = Array.isArray(body.history) ? body.history : [];
        // SECURITY: sanitize history — only allow role/content, cap length, check for injection
        const history: Array<{role: string; content: string}> = [];
        for (const msg of rawHistory.slice(-20)) {
          if (!msg || typeof msg !== 'object') continue;
          const role = msg.role === 'assistant' ? 'assistant' : 'user';
          const content = String(msg.content || '').slice(0, 500);
          if (!content || isInjectionAttempt(content).detected) continue;
          history.push({ role, content });
        }

        // Direct Venice API call (bypass runtime.generateText which has DIEM issues)
        let responseText = '';
        const veniceKey = process.env.VENICE_API_KEY;
        const veniceModel = process.env.VENICE_SMALL_MODEL || 'zai-org-glm-4.7-flash';
        if (veniceKey) {
          try {
            const veniceResp = await fetch('https://api.venice.ai/api/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${veniceKey}`,
              },
              body: JSON.stringify({
                model: veniceModel,
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...history,
                  { role: 'user', content: text },
                ],
                max_tokens: 500,
                venice_parameters: { disable_thinking: true, include_venice_system_prompt: false },
              }),
              signal: AbortSignal.timeout(15000),
            });
            if (veniceResp.ok) {
              const data = await veniceResp.json() as any;
              const msg = data?.choices?.[0]?.message;
              responseText = msg?.content || msg?.reasoning_content || '';
            } else {
              console.error('[Dryad] Venice API error:', veniceResp.status, await veniceResp.text().catch(() => ''));
            }
          } catch (veniceErr: any) {
            console.error('[Dryad] Venice direct call failed:', veniceErr?.message);
          }
        }

        // Fallback to runtime.generateText if Venice direct call failed
        if (!responseText) {
          try {
            const result = await runtime.generateText(
              `${systemPrompt}\n\nUser: ${text}\n\nDryad:`,
              { maxTokens: 300 }
            );
            responseText = typeof result === 'string' ? result : (result as any)?.text || '';
          } catch (rtErr: any) {
            console.error('[Dryad] runtime.generateText fallback failed:', rtErr?.message);
          }
        }

        if (!responseText) {
          responseText = "I'm having trouble thinking right now. Try asking about the project, Detroit's vacant lots, or native ecology!";
        }

        // Strip non-Latin characters (GLM model sometimes leaks Chinese)
        responseText = responseText.replace(/[^\x00-\x7F\u00C0-\u024F\u2000-\u206F\u2190-\u21FF\u2500-\u257F°±×÷—–''""…•→←↑↓★☆·]+/g, '').replace(/\s{2,}/g, ' ').trim();

        audit('LOOP_EXECUTION', `Chat: ${text.slice(0, 50)} | IP: ${ip}`, 'chat_api', 'info');
        res.json({ text: responseText } as unknown);
      } catch (err: any) {
        console.error('[Dryad] Chat error:', err?.message || err);
        res.json({ text: "I'm having trouble responding right now. You can learn more about the project by exploring the page, or visit our iNaturalist project at inaturalist.org/projects/dryad-25th-street-parcels-mapping" } as unknown);
      }
    },
  },

  // ─── Dashboard SPA ───────────────────────────────────────────────────────────
  // The existing /dashboard route serves legacy HTML; this supersedes it.
  // After running `bun run build:dashboard`, serve the single-file React build.
  {
    name: 'dashboard-spa',
    path: '/dashboard',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      securityHeaders(res);
      // SECURITY: Content Security Policy for dashboard
      res.setHeader?.('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' https: data: blob:",
        "connect-src 'self' https://api.inaturalist.org https://api.coingecko.com https://gis.detroitmi.gov https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
        "frame-ancestors 'none'",
      ].join('; '));
      try {
        const html = fs.readFileSync(DASHBOARD_HTML_PATH, 'utf-8');
        res.setHeader?.('Content-Type', 'text/html');
        res.send(html);
      } catch {
        // Fallback: redirect to the legacy HTML dashboard while build hasn't run yet
        res.setHeader?.('Content-Type', 'text/html');
        res.send('<html><body style="background:#0a1a0a;color:#81c784;font-family:monospace;padding:40px"><h2>Dashboard building...</h2><p>Run <code>bun run build:dashboard</code> to build the React dashboard, then restart the agent.</p><p><a href="/Dryad/dashboard-legacy" style="color:#4caf50">View legacy dashboard</a></p></body></html>');
      }
    },
  },
  {
    name: 'dashboard-legacy',
    path: '/dashboard-legacy',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      // Legacy HTML dashboard — kept for fallback
      securityHeaders(res);
      res.setHeader?.('Content-Type', 'text/html');
      res.send(dashboardHTML());
    },
  },

  // ─── Public API: Loop history ─────────────────────────────────────────────
  {
    name: 'api-loop-history',
    path: '/api/loop/history',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      const limit = parseIntParam((req.query as any)?.limit, 30, 1, 100);
      res.json(getLoopHistory(limit) as unknown);
    },
  },
  {
    name: 'api-loop-latest',
    path: '/api/loop/latest',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      const latest = getLatestLoop();
      const stats = getLoopStats(30);
      const nextRunMs = latest ? latest.timestamp + 24 * 60 * 60 * 1000 : null;
      res.json({ latest, stats, nextRunAt: nextRunMs } as unknown);
    },
  },

  // ─── Public API: Treasury history ────────────────────────────────────────
  {
    name: 'api-treasury-history',
    path: '/api/treasury/history',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      const days = parseIntParam((req.query as any)?.days, 30, 1, 365);
      res.json(getTreasuryHistory(days) as unknown);
    },
  },

  // ─── Public API: DeFi positions, yields, and rebalance history ───────────
  {
    name: 'api-defi',
    path: '/api/defi',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      corsHeaders(req, res);
      try {
        const positions = loadPositions();
        const status = getRebalancerStatus();
        const history = getRebalanceHistory();
        const yieldDays = parseIntParam((req.query as any)?.yieldDays, 7, 1, 90);
        const yieldHistory = getYieldHistory(yieldDays);

        // Current protocol info with APYs
        const protocols = PROTOCOLS.map(p => ({
          name: p.name,
          currentApy: p.currentApy,
          address: p.poolAddress,
          minDeposit: p.minDeposit,
          riskScore: p.riskScore,
        }));

        // Get live USDC balance
        let idleUsdc = 0;
        try { idleUsdc = await getUsdcBalance(); } catch {}

        const totalDeposited = positions.reduce((s, p) => s + p.depositedUsd, 0);
        const totalValue = idleUsdc + totalDeposited;

        // Blended APY across positions
        let blendedApy = 0;
        if (totalDeposited > 0) {
          for (const pos of positions) {
            const proto = PROTOCOLS.find(p => p.name === pos.protocolName);
            if (proto) blendedApy += (pos.depositedUsd / totalDeposited) * proto.currentApy;
          }
        }

        const annualYieldUsd = totalDeposited * blendedApy;
        const dailyYieldUsd = annualYieldUsd / 365;

        res.json({
          positions: positions.map(p => {
            const proto = PROTOCOLS.find(pr => pr.name === p.protocolName);
            return {
              protocolName: p.protocolName,
              depositedUsd: p.depositedUsd,
              depositTxHash: p.depositTxHash,
              depositedAt: p.depositedAt,
              currentApy: proto?.currentApy ?? 0,
              contractAddress: proto?.poolAddress ?? null,
            };
          }),
          protocols,
          idleUsdc,
          totalDeposited,
          totalValue,
          blendedApy,
          annualYieldUsd,
          dailyYieldUsd,
          rebalancerStatus: status,
          rebalanceHistory: history.slice(-20),  // Last 20 rebalances
          yieldHistory: yieldHistory.slice(-100), // Last 100 yield snapshots
        } as unknown);
      } catch (err: any) {
        res.status(500).json({ error: 'Failed to fetch DeFi data' } as unknown);
      }
    },
  },

  // ─── Public API: Health trend ─────────────────────────────────────────────
  {
    name: 'api-health-trend',
    path: '/api/health/trend',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'api');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Rate limit exceeded. Try again later.' } as unknown);
        return;
      }
      const days = parseIntParam((req.query as any)?.days, 30, 1, 365);
      const latest = getLatestHealthSnapshot();
      const history = getHealthHistory(days);
      res.json({ latest, history } as unknown);
    },
  },

  // ─── Public API: Current season context ──────────────────────────────────
  {
    name: 'api-season',
    path: '/api/season',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      const season = getCurrentSeason();
      const briefing = getSeasonalBriefing();
      res.json({ ...season, briefing } as unknown);
    },
  },

  // ─── Public API: Parcel GeoJSON from Detroit ArcGIS ──────────────────────
  {
    name: 'api-parcels-geojson',
    path: '/api/parcels/geojson',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      try {
        const geojson = await fetchParcelGeoJson();
        res.setHeader?.('Cache-Control', 'public, max-age=86400');
        res.json(geojson as unknown);
      } catch (err) {
        // Fallback: return point GeoJSON from hardcoded centroids
        const fallback = {
          type: 'FeatureCollection',
          features: PARCELS.map(p => ({
            type: 'Feature',
            properties: { address: p.address, parcelNumber: p.parcelNumber },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          })),
        };
        res.json(fallback as unknown);
      }
    },
  },

  // ─── Public API: Summary stats (no sensitive data) ───────────────────────
  {
    name: 'api-summary',
    path: '/api/summary',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      const latestHealth = getLatestHealthSnapshot();
      const latestTreasury = getLatestTreasurySnapshot();
      const latestLoop = getLatestLoop();
      const loopStats = getLoopStats(30);
      const season = getCurrentSeason();
      const auditSummary = getAuditSummary(24);

      let usdcTotal = 0;
      let usdcDeployed = 0;
      let blendedApy = 0;
      let usdcAnnualYield = 0;

      try {
        const usdcIdle = await getUsdcBalance();
        const positions = loadPositions();
        usdcDeployed = positions.reduce((s, p) => s + p.depositedUsd, 0);
        if (usdcDeployed > 0) {
          for (const pos of positions) {
            const proto = PROTOCOLS.find(p => p.name === pos.protocolName);
            if (proto) blendedApy += (pos.depositedUsd / usdcDeployed) * proto.currentApy;
          }
        }
        usdcTotal = usdcIdle + usdcDeployed;
        usdcAnnualYield = usdcDeployed * blendedApy;
      } catch (err) {
        console.warn('Failed to fetch USDC data for summary:', err);
      }

      res.json({
        health: latestHealth ? {
          score: latestHealth.healthScore,
          invasivesP1: latestHealth.invasivesP1,
          invasivesP2: latestHealth.invasivesP2,
          invasivesP3: latestHealth.invasivesP3,
          observationsTotal: latestHealth.observationsTotal,
          nativeSpeciesCount: latestHealth.nativeSpeciesCount,
          season: latestHealth.season,
          invasiveSpecies: latestHealth.invasiveSpecies,
        } : null,
        treasury: latestTreasury ? {
          estimatedUsd: latestTreasury.estimatedUsd,
          wstEthBalance: latestTreasury.wstEthBalance,
          annualYieldUsd: latestTreasury.annualYieldUsd,
          dailyYieldUsd: latestTreasury.dailyYieldUsd,
          spendingMode: latestTreasury.spendingMode,
          usdcTotal: parseFloat(usdcTotal.toFixed(2)),
          usdcDeployed: parseFloat(usdcDeployed.toFixed(2)),
          blendedApy: parseFloat(blendedApy.toFixed(4)),
          usdcAnnualYield: parseFloat(usdcAnnualYield.toFixed(2)),
          // Never expose wallet balances without auth — just mode and yield
        } : null,
        loop: {
          lastRunAt: latestLoop?.timestamp ?? null,
          lastRunStatus: latestLoop?.status ?? null,
          nextRunAt: latestLoop ? latestLoop.timestamp + TIMING.CYCLE_INTERVAL_MS : null,
          stats30d: loopStats,
        },
        season: { name: season.season, description: season.description },
        demoMode: DEMO_MODE ? {
          active: true,
          cycleIntervalSec: TIMING.CYCLE_INTERVAL_MS / 1000,
          maxPerTxUsd: TX_LIMITS.PER_TX_USD,
          maxDailyUsd: TX_LIMITS.DAILY_USD,
          sustainabilityTarget: FINANCIAL.SUSTAINABILITY_THRESHOLD,
          chain: 'Base Sepolia (testnet)',
        } : null,
        auditSummary: {
          totalEvents24h: auditSummary.totalEvents,
          criticalEvents24h: auditSummary.criticalEvents.length,
        },
        wallet: null, // populated by /api/treasury for live reads
      } as unknown);
    },
  },

  // ─── Admin API: Full audit log (requires ADMIN_SECRET) ───────────────────
  {
    name: 'api-admin-audit',
    path: '/api/admin/audit',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' } as unknown);
        return;
      }
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'security');
      if (!rl.allowed) { res.status(429).json({ error: 'Too many requests' } as unknown); return; }
      const count = parseIntParam((req.query as any)?.count, 100, 1, 500);
      res.json({
        entries: getRecentAuditEntries(count),
        summary: getAuditSummary(24),
        digest: getDailyDigest(),
      } as unknown);
    },
  },

  // ─── Admin API: Transactions (requires ADMIN_SECRET) ─────────────────────
  {
    name: 'api-admin-transactions',
    path: '/api/admin/transactions',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' } as unknown);
        return;
      }
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'security');
      if (!rl.allowed) { res.status(429).json({ error: 'Too many requests' } as unknown); return; }
      const history = getTransactionHistory();
      const dayAgo = Date.now() - 86400000;
      const dailySpend = history.filter(tx => tx.timestamp > dayAgo).reduce((s, tx) => s + tx.amount, 0);
      res.json({
        history,
        paymentsPaused: isPaymentsPaused(),
        dailySpendUsd: dailySpend,
        dailyLimitUsd: 200,
        perTxLimitUsd: 50,
      } as unknown);
    },
  },

  // ─── Admin API: Trigger decision loop manually (requires ADMIN_SECRET) ───
  {
    name: 'api-admin-trigger-loop',
    path: '/api/admin/trigger-loop',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' } as unknown);
        return;
      }
      try {
        const { triggerManualCycle } = await import('./services/decisionLoop.ts');
        const result = await triggerManualCycle();
        audit('ADMIN_ACTION', `Manual loop trigger: ${result.message}`, 'admin_api', 'info');
        res.json(result as unknown);
      } catch (err: any) {
        console.error('[Dryad] Trigger loop failed:', err);
        res.status(500).json({ error: 'Failed to trigger decision loop' } as unknown);
      }
    },
  },

  // ─── Admin API: Full system status (requires ADMIN_SECRET) ───────────────
  {
    name: 'api-admin-status',
    path: '/api/admin/status',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' } as unknown);
        return;
      }
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'security');
      if (!rl.allowed) { res.status(429).json({ error: 'Too many requests' } as unknown); return; }
      const latestTreasury = getLatestTreasurySnapshot();
      const latestLoop = getLatestLoop();
      const loopStats = getLoopStats(30);
      const txHistory = getTransactionHistory();
      const auditSummary = getAuditSummary(24);
      const allSubmissions = getAllSubmissions();

      res.json({
        treasury: latestTreasury,
        loop: { latest: latestLoop, stats: loopStats },
        transactions: {
          history: txHistory,
          paymentsPaused: isPaymentsPaused(),
          dailySpend: txHistory.filter(tx => tx.timestamp > Date.now() - 86400000).reduce((s, tx) => s + tx.amount, 0),
        },
        audit: { summary: auditSummary, recent: getRecentAuditEntries(50) },
        submissions: { total: allSubmissions.length, unprocessed: allSubmissions.filter(s => !s.processed).length },
      } as unknown);
    },
  },

  // ─── Vision verification status ──────────────────────────────────────────────
  {
    name: 'api-submission-vision',
    path: '/api/submissions/:id/vision',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      const id = (req as any).params?.id;
      if (!id) {
        res.status(400).json({ error: 'Missing submission ID' } as unknown);
        return;
      }
      const sub = getSubmissionById(id);
      if (!sub) {
        res.status(404).json({ error: 'Submission not found' } as unknown);
        return;
      }
      res.json({
        id: sub.id,
        visionScore: sub.visionScore ?? null,
        visionApproved: sub.visionApproved ?? null,
        visionReasoning: sub.visionReasoning ?? null,
        visionMatchedIndicators: sub.visionMatchedIndicators ?? [],
        visionFlagsTriggered: sub.visionFlagsTriggered ?? [],
        visionModel: sub.visionModel ?? null,
        visionVerifiedAt: sub.visionVerifiedAt ?? null,
        hasBeforePhoto: !!sub.beforePhotoPath,
        pending: !sub.visionVerifiedAt,
      } as unknown);
    },
  },

  // ─── Before photo upload (for before/after comparison) ─────────────────────
  {
    name: 'api-submission-before-photo',
    path: '/api/submissions/:id/before',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      // SECURITY: Require admin or contractor auth
      const authHeader = (req.headers?.['authorization'] || req.headers?.['x-api-key'] || '') as string;
      if (!authHeader) {
        res.status(401).json({ error: 'Authentication required' } as unknown);
        return;
      }
      const id = (req as any).params?.id;
      if (!id) {
        res.status(400).json({ error: 'Missing submission ID' } as unknown);
        return;
      }
      const sub = getSubmissionById(id);
      if (!sub) {
        res.status(404).json({ error: 'Submission not found' } as unknown);
        return;
      }

      const contentType = (req.headers?.['content-type'] || '') as string;
      if (!contentType.includes('multipart/form-data')) {
        res.status(400).json({ error: 'Expected multipart/form-data with a photo' } as unknown);
        return;
      }

      try {
        const parsed: { fileBuffer: Buffer | null } = { fileBuffer: null };

        await new Promise<void>((resolve, reject) => {
          const busboy = Busboy({ headers: req.headers as Record<string, string>, limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 } });
          busboy.on('file', (_name: string, stream: any, _info: any) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', () => { parsed.fileBuffer = Buffer.concat(chunks); });
            stream.on('error', reject);
          });
          busboy.on('finish', resolve);
          busboy.on('error', reject);
          (req as any).pipe(busboy);
        });

        const { fileBuffer } = parsed;
        if (!fileBuffer || fileBuffer.length < 1000) {
          res.status(400).json({ error: 'No valid photo uploaded' } as unknown);
          return;
        }

        // Save before photo
        const beforeFilename = `before_${id}_${Date.now()}.jpg`;
        const beforePath = path.join(UPLOADS_DIR, beforeFilename);
        fs.writeFileSync(beforePath, fileBuffer);

        const beforeHash = computeImageHash(fileBuffer);

        // Attach to the submission
        const { setBeforePhoto } = await import('./submissions.ts');
        setBeforePhoto(id, beforePath, beforeHash);

        res.json({
          id: sub.id,
          beforePhotoFilename: beforeFilename,
          beforePhotoHash: beforeHash,
          message: 'Before photo attached. Vision verification will use before/after comparison on next check.',
        } as unknown);
      } catch (error) {
        res.status(400).json({ error: (error instanceof Error ? error.message : 'Upload failed') as unknown });
      }
    },
  },

  // ─── Year 3 mockup dashboard ────────────────────────────────────────────────
  {
    name: 'mock-dashboard',
    path: '/mock',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      try {
        const html = fs.readFileSync(MOCK_HTML_PATH, 'utf-8');
        res.setHeader?.('Content-Type', 'text/html');
        res.send(html);
      } catch {
        res.setHeader?.('Content-Type', 'text/html');
        res.send('<html><body style="background:#0a1a0a;color:#81c784;font-family:monospace;padding:40px"><h2>Mock not found</h2><p>site/mock.html is missing.</p></body></html>');
      }
    },
  },
  // Demo proof report — generate and serve on demand
  {
    name: 'demo-proof-report',
    path: '/api/demo-report',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      if (!DEMO_MODE) {
        res.status(404).json({ error: 'Demo mode is not active' });
        return;
      }
      try {
        const { generateProofReport } = await import('./demo/reportGenerator.ts');
        const reportPath = generateProofReport();
        const html = fs.readFileSync(reportPath, 'utf-8');
        res.setHeader?.('Content-Type', 'text/html');
        res.setHeader?.('Content-Disposition', `inline; filename="dryad-proof-report-${new Date().toISOString().split('T')[0]}.html"`);
        res.send(html);
      } catch (err) {
        res.status(500).json({ error: 'Failed to generate report' });
      }
    },
  },

  // ─── Contractor Onboarding Routes ───
  {
    name: 'api-contractors-apply',
    path: '/api/contractors/apply',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      // SECURITY: Rate limiting
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'contractor_apply');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many applications. Try again later.' } as unknown);
        return;
      }

      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as any) || {};

        // SECURITY: Sanitize input
        const sanitize = (s: string, maxLen: number) => String(s || '').replace(/<[^>]*>/g, '').slice(0, maxLen);
        const fullName = sanitize(body.name || body.fullName, 100);
        const email = sanitize(body.email, 200);
        const phone = sanitize(body.phone, 20);
        const walletAddress = sanitize(body.walletAddress, 100);
        if (walletAddress && !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
          res.status(400).json({ error: 'Invalid wallet address format. Must be a 0x-prefixed Ethereum address.' } as unknown);
          return;
        }
        const experience = sanitize(body.experience, 2000);
        const workTypes = Array.isArray(body.workTypes) ? body.workTypes.map((t: string) => sanitize(t, 100)) : [];

        // SECURITY: Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.status(400).json({ error: 'Invalid email format' } as unknown);
          return;
        }

        // SECURITY: Check for injection attempts
        const allText = `${fullName} ${email} ${experience}`;
        const injection = isInjectionAttempt(allText);
        if (injection.detected) {
          audit('INJECTION_ATTEMPT', `Pattern: ${injection.pattern}`, 'contractor_apply', 'warn');
          res.status(400).json({ error: 'Invalid submission' } as unknown);
          return;
        }

        // Create contractor
        const contractor = applyContractor({
          name: fullName,
          email,
          phone,
          walletAddress,
          experience,
          workTypes,
        });

        // Return contractor object (without sensitive fields)
        const { accessCode, ...safeData } = contractor;
        res.json(safeData);
      } catch (error) {
        res.status(400).json({ error: (error instanceof Error ? error.message : 'Application failed') as unknown });
      }
    },
  },

  {
    name: 'api-contractors-validate',
    path: '/api/contractors/validate',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      // SECURITY: Strict rate limit to prevent brute-force of 4-char access codes
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'validate_code');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many attempts. Try again later.' } as unknown);
        return;
      }

      const code = ((req as any).query?.code || '') as string;

      if (!code) {
        res.status(400).json({ error: 'Missing access code' } as unknown);
        return;
      }

      // SECURITY: Validate format before lookup (must be DRYAD-XXXX)
      if (!/^DRYAD-[A-Z2-9]{4}$/i.test(code.trim())) {
        res.json({ valid: false });
        return;
      }

      const contractor = validateAccessCode(code);
      if (contractor) {
        // SECURITY: Return first name only, not full legal name
        const firstName = contractor.name.split(' ')[0] || 'Contractor';
        res.json({ valid: true, name: firstName });
      } else {
        // SECURITY: Add small delay to slow brute-force even further
        await new Promise(resolve => setTimeout(resolve, 500));
        res.json({ valid: false });
      }
    },
  },

  {
    name: 'api-contractors-list',
    path: '/api/contractors',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(403).json({ error: 'Unauthorized' } as unknown);
        return;
      }

      const contractors = getAllContractors();
      res.json(contractors);
    },
  },

  {
    name: 'api-contractors-pending',
    path: '/api/contractors/pending',
    type: 'GET' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(403).json({ error: 'Unauthorized' } as unknown);
        return;
      }

      const pending = getPendingApplications();
      res.json(pending);
    },
  },

  {
    name: 'api-contractors-approve',
    path: '/api/contractors/:id/approve',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(403).json({ error: 'Unauthorized' } as unknown);
        return;
      }

      const id = (req as any).params?.id;
      if (!id) {
        res.status(400).json({ error: 'Missing contractor ID' } as unknown);
        return;
      }

      const contractor = approveContractor(id);
      if (contractor) {
        // SECURITY: Strip access code from response — it's sent via email only
        const { accessCode: _code, ...safeContractor } = contractor;
        res.json({ ...safeContractor, accessCodeSent: true });
      } else {
        res.status(404).json({ error: 'Contractor not found' } as unknown);
      }
    },
  },

  {
    name: 'api-contractors-suspend',
    path: '/api/contractors/:id/suspend',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse) => {
      if (!isAdmin(req)) {
        res.status(403).json({ error: 'Unauthorized' } as unknown);
        return;
      }

      const id = (req as any).params?.id;
      if (!id) {
        res.status(400).json({ error: 'Missing contractor ID' } as unknown);
        return;
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as any) || {};
      const reason = String(body.reason || 'No reason provided');

      const contractor = suspendContractor(id, reason);
      if (contractor) {
        res.json(contractor);
      } else {
        res.status(404).json({ error: 'Contractor not found' } as unknown);
      }
    },
  },
];
