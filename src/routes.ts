/**
 * Custom routes for Dryad: /submit portal, /dashboard, /api/submissions
 */
import type { RouteRequest, RouteResponse, IAgentRuntime } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';
import { addSubmission, getAllSubmissions } from './submissions.ts';
import { PARCELS, PARCEL_BOUNDS } from './parcels.ts';
import { isInjectionAttempt, sanitizeSubmissionDescription, logSecurityEvent, getSecurityLog } from './security/sanitize.ts';
import { getTransactionHistory, isPaymentsPaused } from './security/transactionGuard.ts';
import { checkRateLimit } from './security/rateLimiter.ts';
import { getAuditSummary, getRecentAuditEntries, getDailyDigest } from './services/auditLog.ts';
import { audit } from './services/auditLog.ts';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads dir exists
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

// Rate limiting handled by src/security/rateLimiter.ts

// iNaturalist URLs
const INAT_PROJECT_URL = 'https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping';
const INAT_OBS_URL = `https://www.inaturalist.org/observations?nelat=${PARCEL_BOUNDS.ne.lat}&nelng=${PARCEL_BOUNDS.ne.lng}&swlat=${PARCEL_BOUNDS.sw.lat}&swlng=${PARCEL_BOUNDS.sw.lng}`;
const INAT_API_URL = `https://api.inaturalist.org/v1/observations?nelat=${PARCEL_BOUNDS.ne.lat}&nelng=${PARCEL_BOUNDS.ne.lng}&swlat=${PARCEL_BOUNDS.sw.lat}&swlng=${PARCEL_BOUNDS.sw.lng}`;

// ─── /submit page ───
function submitPageHTML(): string {
  const parcelOptions = PARCELS.map((p) => `<option value="${p.address}">${p.address}</option>`).join('');
  const workTypeOptions = ['Invasive Removal', 'Soil Prep', 'Native Planting', 'Monitoring / Survey', 'Debris Cleanup', 'Weed Whacking'].map((t) => `<option value="${t}">${t}</option>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dryad — Submit Proof of Work</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a1a0a;color:#e0e0e0;min-height:100vh}
.container{max-width:640px;margin:0 auto;padding:24px}
h1{color:#4caf50;margin-bottom:4px;font-size:28px}
h2{color:#66bb6a;font-size:20px;margin-bottom:12px}
.subtitle{color:#81c784;margin-bottom:24px}
.card{background:#1a2e1a;border:1px solid #2e7d32;border-radius:12px;padding:24px;margin-bottom:16px}
.card-community{background:#0d1f0d;border:1px solid #1b5e20;border-radius:12px;padding:24px;margin-bottom:16px}
label{display:block;font-weight:600;margin-bottom:6px;color:#a5d6a7}
input,select,textarea{width:100%;padding:10px;border:1px solid #2e7d32;border-radius:8px;background:#0d1f0d;color:#e0e0e0;margin-bottom:16px;font-size:14px}
input[type=file]{padding:8px}
textarea{resize:vertical;min-height:80px}
button{background:#2e7d32;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:16px;font-weight:600;width:100%}
button:hover{background:#388e3c}
.success{background:#1b5e20;border:1px solid #4caf50;padding:16px;border-radius:8px;margin-top:16px}
.error{background:#4a1010;border:1px solid #c62828;padding:16px;border-radius:8px;margin-top:16px}
.info{font-size:13px;color:#81c784;margin-bottom:16px}
a{color:#81c784}
.divider{border:none;border-top:2px solid #2e7d32;margin:32px 0}
.qr-section{text-align:center;padding:16px 0}
.qr-placeholder{width:200px;height:200px;margin:16px auto;background:#fff;border-radius:12px;display:flex;align-items:center;justify-content:center;padding:8px}
.app-links{display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.app-links a{background:#1b5e20;padding:8px 16px;border-radius:8px;text-decoration:none;color:#fff;font-size:14px}
.nav{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.nav a{color:#81c784;text-decoration:none;padding:10px 14px;border:1px solid #2e7d32;border-radius:8px;font-size:14px;min-height:44px;display:flex;align-items:center}
.nav a:hover{background:#1b5e20}
.gps-status{padding:12px;border-radius:8px;margin-bottom:16px;font-size:14px;display:flex;align-items:center;gap:8px}
.gps-status.success{background:#1b5e20;border:1px solid #4caf50;color:#a5d6a7}
.gps-status.pending{background:#1a2e1a;border:1px solid #2e7d32;color:#81c784}
.gps-status.error{background:#4a1010;border:1px solid #c62828;color:#ef9a9a}
.gps-btn{background:#1b5e20;color:#a5d6a7;border:1px solid #2e7d32;padding:12px 16px;border-radius:8px;cursor:pointer;font-size:14px;width:100%;margin-bottom:16px;min-height:44px}
.gps-btn:hover{background:#2e7d32}
.gps-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.btn-loading{opacity:0.7;pointer-events:none}
@media (max-width: 480px) {
  .container{padding:16px}
  .nav{gap:6px}
  .nav a{padding:8px 10px;font-size:13px}
  h1{font-size:22px}
}
</style>
</head><body>
<div class="container">
<div class="nav"><a href="https://www.inaturalist.org/pages/seek_app" target="_blank" style="background:#2e7d32;color:#fff;font-weight:600">🌿 Identify Flora</a><a href="/">Chat</a><a href="/Dryad/submit">Submit</a><a href="/Dryad/dashboard">Dashboard</a></div>

<h1>Contractor Proof-of-Work</h1>
<p class="subtitle">Submit GPS-tagged photos to verify completed work on 25th Street parcels</p>

<form id="submitForm" class="card" enctype="multipart/form-data">
  <input type="hidden" name="type" value="proof_of_work">

  <label>Photo of Completed Work (GPS-tagged) *</label>
  <input type="file" name="photo" id="photo" accept="image/*" capture="environment" required>
  <p class="info">Take with location services ON. Shows: cut stumps, cleared areas, new plantings, debris piles, etc.</p>

  <label>Parcel *</label>
  <select name="parcel" id="parcel">${parcelOptions}</select>

  <label>Work Type *</label>
  <select name="workType" id="workType">${workTypeOptions}</select>

  <div id="gpsStatus" class="gps-status pending">Waiting for location...</div>
  <button type="button" class="gps-btn" id="gpsBtn" onclick="getGPS()">📍 Use My Location</button>
  <div class="gps-fields">
    <div><label>Latitude *</label><input type="number" name="lat" id="lat" step="any" placeholder="42.3290" required></div>
    <div><label>Longitude *</label><input type="number" name="lng" id="lng" step="any" placeholder="-83.1058" required></div>
  </div>

  <label>Photo Timestamp</label>
  <input type="datetime-local" name="timestamp" id="timestamp">

  <label>Description of Work *</label>
  <textarea name="description" id="description" placeholder="e.g. Removed 3 Tree of Heaven saplings at NW corner, applied glyphosate to stumps, bagged debris" required></textarea>

  <label>Your Name *</label>
  <input type="text" name="contractorName" id="contractorName" placeholder="Full name" required>

  <label>Your Email (for payment confirmation) *</label>
  <input type="email" name="contractorEmail" id="contractorEmail" placeholder="you@example.com" required>

  <p class="info">GPS must be within parcel boundaries (25th St between Ash & Beech). Photos older than 72 hours will be rejected. Payment up to $50/job in USDC on Base.</p>

  <button type="submit" id="submitBtn" style="min-height:48px">Submit Proof of Work</button>
</form>
<div id="result"></div>

<hr class="divider">

<div class="card-community">
  <h2>Visiting the forest? Help us catalog species!</h2>
  <p style="margin-bottom:16px">Download the <strong>iNaturalist</strong> app (free) and photograph any plants you find on our lots at 25th Street between Ash and Beech. Your observations automatically feed into Dryad's ecosystem monitoring — no account with us needed.</p>

  <div class="qr-section">
    <div class="qr-placeholder">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(INAT_PROJECT_URL)}" alt="QR Code — Dryad iNaturalist Project" width="180" height="180">
    </div>
    <p style="font-size:13px;color:#81c784;margin-top:8px">Scan to join our iNaturalist project</p>
  </div>

  <div class="app-links">
    <a href="https://apps.apple.com/app/inaturalist/id421397028" target="_blank">iNaturalist for iOS</a>
    <a href="https://play.google.com/store/apps/details?id=org.inaturalist.android" target="_blank">iNaturalist for Android</a>
    <a href="${INAT_PROJECT_URL}" target="_blank">Join Our Project</a>
    <a href="${INAT_OBS_URL}" target="_blank">View Observations</a>
  </div>

  <p style="font-size:13px;color:#81c784;margin-top:16px;text-align:center">iNaturalist's AI identifies species from photos. Community members verify. Research-grade observations feed directly into Dryad's health score.</p>
</div>

</div>

<script>
function getGPS() {
  const status = document.getElementById('gpsStatus');
  const btn = document.getElementById('gpsBtn');
  if (!navigator.geolocation) {
    status.className = 'gps-status error';
    status.textContent = 'Geolocation not supported — enter coordinates manually';
    return;
  }
  status.className = 'gps-status pending';
  status.textContent = 'Getting location...';
  btn.textContent = '⏳ Locating...';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('lng').value = pos.coords.longitude.toFixed(6);
    status.className = 'gps-status success';
    status.textContent = '✓ Location captured: ' + pos.coords.latitude.toFixed(4) + ', ' + pos.coords.longitude.toFixed(4) + ' (±' + Math.round(pos.coords.accuracy) + 'm)';
    btn.textContent = '📍 Update Location';
    btn.disabled = false;
  }, (err) => {
    status.className = 'gps-status error';
    status.textContent = 'Location failed — enter coordinates manually below';
    btn.textContent = '📍 Try Again';
    btn.disabled = false;
  }, { enableHighAccuracy: true, timeout: 10000 });
}

// Auto-fill GPS on load
getGPS();

document.getElementById('timestamp').value = new Date().toISOString().slice(0,16);

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = document.getElementById('result');
  const btn = document.getElementById('submitBtn');
  btn.textContent = 'Submitting...';
  btn.classList.add('btn-loading');

  // Build JSON payload from form
  const payload = {};
  form.forEach((v, k) => { if (k !== 'photo') payload[k] = v; });

  try {
    const resp = await fetch('/Dryad/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.verified) {
      res.textContent = '';
      var d = document.createElement('div'); d.className = 'success';
      d.textContent = 'Submission verified! Parcel: ' + data.nearestParcel + ' | Distance: ' + data.distanceMeters.toFixed(0) + 'm | ID: ' + data.id;
      res.appendChild(d);
    } else {
      res.textContent = '';
      var d = document.createElement('div'); d.className = 'error';
      d.textContent = 'Verification failed: ' + data.verificationErrors.join(', ');
      res.appendChild(d);
    }
  } catch (err) {
    res.textContent = '';
    var d = document.createElement('div'); d.className = 'error';
    d.textContent = 'Error: ' + err.message;
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
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a1a0a;color:#e0e0e0;min-height:100vh}
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
<div class="header">
  <h1>🌿 Dryad Dashboard</h1>
  <nav><a href="https://www.inaturalist.org/pages/seek_app" target="_blank" style="background:#2e7d32;color:#fff;padding:6px 12px;border-radius:6px;font-weight:600">🌿 Identify Flora</a><a href="/">Chat</a><a href="/Dryad/submit">Submit Work</a><a href="/Dryad/dashboard">Dashboard</a></nav>
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
    <div id="healthScore" class="loading">Loading...</div>
  </div>

  <!-- Treasury -->
  <div class="card">
    <h2>Treasury</h2>
    <div id="treasury" class="loading">Loading...</div>
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
    <div id="stressTest" class="loading">Loading...</div>
    <p style="font-size:12px;color:#81c784;margin-top:8px">Target: 60% stETH / 40% USDC split. Sustainability: $27K in stETH at 3.5% APR to cover $945/yr (Yr 3+).</p>
  </div>

  <!-- Milestones -->
  <div class="card">
    <h2>Onchain Milestones</h2>
    <div id="milestones" class="loading">Loading...</div>
  </div>

  <!-- Spending Mode -->
  <div class="card">
    <h2>Adaptive Spending Mode</h2>
    <div id="spendingMode" class="loading">Loading...</div>
  </div>

  <!-- iNaturalist Observations -->
  <div class="card full">
    <h2>iNaturalist Observations on Parcels</h2>
    <div id="inatObs" class="loading">Loading from iNaturalist API...</div>
    <p style="font-size:12px;color:#81c784;margin-top:8px"><a href="${INAT_OBS_URL}" target="_blank">View all observations</a> | <a href="/Dryad/submit">Help catalog species with iNaturalist</a> | <img src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(INAT_OBS_URL)}" alt="QR" width="40" height="40" style="vertical-align:middle;margin-left:8px;border-radius:4px"></p>
  </div>

  <!-- Recent Contractor Submissions -->
  <div class="card full">
    <h2>Contractor Proof-of-Work Submissions</h2>
    <div id="submissions" class="loading">Loading...</div>
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
      <tr><th>Steward</th><td>Nick George (powahgen@gmail.com)</td></tr>
      <tr><th>Decision Loop</th><td>Every 6 hours</td></tr>
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
  const ethPrice = 2600;
  const ethN = parseFloat(data.ethBalance || '0');
  const wstN = parseFloat(data.wstethBalance || '0');
  const totalUSD = ((ethN + wstN) * ethPrice).toFixed(0);
  const annualYield = (wstN * ethPrice * 0.035).toFixed(2);

  document.getElementById('treasury').innerHTML = \`
    <div class="stat-row">
      <div class="stat-item"><div class="stat">\${data.ethBalance || '0'}</div><div class="stat-label">ETH</div></div>
      <div class="stat-item"><div class="stat">\${data.wstethBalance || '0'}</div><div class="stat-label">wstETH</div></div>
    </div>
    <div class="stat-row">
      <div class="stat-item"><div class="stat">~$\${totalUSD}</div><div class="stat-label">Total USD value</div></div>
      <div class="stat-item"><div class="stat">\${data.dailyYieldUSD || '$0'}</div><div class="stat-label">Daily Yield</div></div>
    </div>
    <p style="font-size:12px;color:#81c784">Annual yield: ~$\${annualYield} | Target: 60% stETH / 40% USDC</p>
    <p style="font-size:12px;color:#81c784">Wallet: <code>\${data.wallet || '—'}</code></p>
  \`;
  document.getElementById('walletAddr').textContent = data.wallet || '—';

  // Stress test
  const stethUSD = wstN * ethPrice;
  const drop30 = stethUSD * 0.7 * 0.035;
  const drop50 = stethUSD * 0.5 * 0.035;
  document.getElementById('stressTest').innerHTML = \`
    <table>
      <tr><th>Scenario</th><th style="text-align:right">Annual Yield</th><th style="text-align:right">vs $945 cost</th></tr>
      <tr><td>Current</td><td style="text-align:right">$\${annualYield}</td><td style="text-align:right;color:\${parseFloat(annualYield)>=945?'#4caf50':'#ef5350'}">\${parseFloat(annualYield)>=945?'✅ Covered':'⚠️ Shortfall $'+(945-parseFloat(annualYield)).toFixed(0)}</td></tr>
      <tr><td>ETH -30%</td><td style="text-align:right">$\${drop30.toFixed(0)}</td><td style="text-align:right;color:\${drop30>=945?'#4caf50':'#ef5350'}">\${drop30>=945?'✅':'⚠️ -$'+(945-drop30).toFixed(0)}</td></tr>
      <tr><td>ETH -50%</td><td style="text-align:right">$\${drop50.toFixed(0)}</td><td style="text-align:right;color:\${drop50>=945?'#4caf50':'#ef5350'}">\${drop50>=945?'✅':'⚠️ -$'+(945-drop50).toFixed(0)}</td></tr>
    </table>
    <p style="font-size:12px;color:#81c784;margin-top:8px">Need $27K in stETH (~10.4 ETH) for Year 3+ self-sustainability.</p>
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
    return '<tr' + (isInvasive ? ' style="color:#ef5350;font-weight:600"' : '') + '><td>' + name + (isInvasive ? ' ⚠️' : '') + '<br><span style="font-size:11px;color:#888">' + sci + '</span></td><td>' + observer + '</td><td>' + date + '</td><td>' + grade + '</td></tr>';
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
    ' <span style="color:#666;font-size:12px">' + new Date(s.submittedAt).toLocaleString() + '</span>' +
    '</div>'
  ).join('');
}).catch(()=>{ document.getElementById('submissions').textContent = 'Failed to load'; });
</script>
</body></html>`;
}

export const dryadRoutes = [
  {
    name: 'submit-page',
    path: '/submit',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      res.setHeader?.('Content-Type', 'text/html');
      res.send(submitPageHTML());
    },
  },
  {
    name: 'dashboard-page',
    path: '/dashboard',
    type: 'GET' as const,
    handler: async (_req: RouteRequest, res: RouteResponse) => {
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

      try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as any) || {};

        // SECURITY: Input sanitization — strip HTML tags, enforce length limits
        const sanitize = (s: string, maxLen: number) => String(s || '').replace(/<[^>]*>/g, '').slice(0, maxLen);
        const lat = parseFloat(body?.lat || '0');
        const lng = parseFloat(body?.lng || '0');

        // SECURITY: Reject obviously invalid coordinates
        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          res.status(400).json({ error: 'Invalid GPS coordinates' } as unknown);
          return;
        }

        const timestamp = body?.timestamp ? new Date(body.timestamp).getTime() : Date.now();
        const type = body?.type === 'plant_id' ? 'plant_id' : 'proof_of_work'; // Whitelist types
        const species = sanitize(body?.species, 200);
        const workType = sanitize(body?.workType, 100);
        const description = sanitize(body?.description, 2000);
        const contractorName = sanitize(body?.contractorName, 100);
        const contractorEmail = sanitize(body?.contractorEmail, 200);
        // SECURITY: Sanitize filename — no path traversal
        const photoFilename = `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;

        // SECURITY: Check for injection attempts in all text fields
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
      const subs = getAllSubmissions().map(({ contractorEmail, ...rest }) => rest);
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

        const pk = process.env.EVM_PRIVATE_KEY;
        if (!pk) { res.json({ error: 'No wallet' }); return; }

        const account = privateKeyToAccount(pk as `0x${string}`);
        const client = createPublicClient({ chain: base, transport: http() });

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

        res.json({
          wallet: account.address,
          ethBalance: ethNum.toFixed(6),
          wstethBalance: wstethNum.toFixed(6),
          dailyYieldUSD: `$${dailyYield.toFixed(2)}`,
          monthlyYieldUSD: `$${(dailyYield * 30).toFixed(2)}`,
        });
      } catch (e) {
        res.json({ error: e instanceof Error ? e.message : 'Failed' });
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

        const client = createPublicClient({ chain: base, transport: http() });
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
      const adminSecret = process.env.ADMIN_SECRET;
      if (!adminSecret || req.headers?.['x-admin-secret'] !== adminSecret) {
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
    handler: async (_req: RouteRequest, res: RouteResponse) => {
      res.setHeader?.('Access-Control-Allow-Origin', '*');
      res.setHeader?.('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');
      res.json({ status: 'ok', usage: 'POST with {text: "your question"}' } as unknown);
    },
  },
  {
    name: 'api-chat',
    path: '/api/chat',
    type: 'POST' as const,
    handler: async (req: RouteRequest, res: RouteResponse, runtime: IAgentRuntime) => {
      // CORS headers for cross-origin requests from Vercel
      res.setHeader?.('Access-Control-Allow-Origin', '*');
      res.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');

      // Rate limiting
      const ip = (req as any).ip || (req as any).connection?.remoteAddress || 'unknown';
      const rl = checkRateLimit(ip, 'message');
      if (!rl.allowed) {
        res.status(429).json({ error: 'Too many messages. Try again later.' } as unknown);
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

        const systemPrompt = `You are Dryad, an autonomous AI agent managing 9 vacant lots at 4475-4523 25th Street in Detroit's Chadsey-Condon neighborhood. You restore native lakeplain oak opening habitat using DeFi yield from stETH. You are registered onchain as ERC-8004 Agent #35293 on Base. Your ENS name is dryadforest.eth. You monitor biodiversity via iNaturalist, manage contractors for invasive removal and native plantings, and record milestones onchain. Be helpful, knowledgeable about Detroit ecology and vacant land, and enthusiastic about conservation. Keep responses concise (2-4 sentences for simple questions, longer for complex ones).`;

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
                  { role: 'user', content: text },
                ],
                max_tokens: 500,
                venice_parameters: { disable_thinking: true },
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

        audit('LOOP_EXECUTION', `Chat: ${text.slice(0, 50)} | IP: ${ip}`, 'chat_api', 'info');
        res.json({ text: responseText } as unknown);
      } catch (err: any) {
        console.error('[Dryad] Chat error:', err?.message || err);
        res.json({ text: "I'm having trouble responding right now. You can learn more about the project by exploring the page, or visit our iNaturalist project at inaturalist.org/projects/dryad-25th-street-parcels-mapping" } as unknown);
      }
    },
  },
];
