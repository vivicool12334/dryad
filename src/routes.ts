/**
 * Custom routes for Dryad: /submit portal, /dashboard, /api/submissions
 */
import type { RouteRequest, RouteResponse } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';
import { addSubmission, getAllSubmissions } from './submissions.ts';
import { PARCELS, PARCEL_BOUNDS } from './parcels.ts';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');

// Ensure uploads dir exists
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch {}

// ─── /submit page ───
function submitPageHTML(): string {
  const parcelOptions = PARCELS.map((p) => `<option value="${p.address}">${p.address}</option>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dryad — Photo Submission</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0a1a0a;color:#e0e0e0;min-height:100vh}
.container{max-width:640px;margin:0 auto;padding:24px}
h1{color:#4caf50;margin-bottom:8px;font-size:28px}
.subtitle{color:#81c784;margin-bottom:24px}
.card{background:#1a2e1a;border:1px solid #2e7d32;border-radius:12px;padding:24px;margin-bottom:16px}
label{display:block;font-weight:600;margin-bottom:6px;color:#a5d6a7}
input,select,textarea{width:100%;padding:10px;border:1px solid #2e7d32;border-radius:8px;background:#0d1f0d;color:#e0e0e0;margin-bottom:16px;font-size:14px}
input[type=file]{padding:8px}
textarea{resize:vertical;min-height:80px}
button{background:#2e7d32;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:16px;font-weight:600;width:100%}
button:hover{background:#388e3c}
.success{background:#1b5e20;border:1px solid #4caf50;padding:16px;border-radius:8px;margin-top:16px}
.error{background:#4a1010;border:1px solid #c62828;padding:16px;border-radius:8px;margin-top:16px}
.info{font-size:13px;color:#81c784;margin-bottom:16px}
.tabs{display:flex;gap:8px;margin-bottom:16px}
.tab{padding:8px 16px;border-radius:8px;cursor:pointer;background:#0d1f0d;border:1px solid #2e7d32;color:#a5d6a7}
.tab.active{background:#2e7d32;color:#fff}
a{color:#81c784}
</style>
</head><body>
<div class="container">
<h1>🌿 Dryad — Photo Submission</h1>
<p class="subtitle">Submit GPS-tagged photos from 25th Street parcels</p>

<div class="tabs">
  <div class="tab active" onclick="setType('plant_id')">Plant Identification</div>
  <div class="tab" onclick="setType('proof_of_work')">Proof of Work</div>
</div>

<form id="submitForm" class="card" enctype="multipart/form-data">
  <input type="hidden" name="type" id="subType" value="plant_id">

  <label>Photo (GPS-tagged) *</label>
  <input type="file" name="photo" id="photo" accept="image/*" required>

  <label>Nearest Parcel</label>
  <select name="parcel" id="parcel">${parcelOptions}</select>

  <label>GPS Latitude *</label>
  <input type="number" name="lat" id="lat" step="any" placeholder="42.3378" required>

  <label>GPS Longitude *</label>
  <input type="number" name="lng" id="lng" step="any" placeholder="-83.0972" required>

  <label>Photo Timestamp (auto-filled from EXIF if available)</label>
  <input type="datetime-local" name="timestamp" id="timestamp">

  <div id="plantFields">
    <label>Species Identified</label>
    <input type="text" name="species" id="species" placeholder="e.g. Ailanthus altissima (Tree of Heaven)">
  </div>

  <label>Description *</label>
  <textarea name="description" id="description" placeholder="What did you observe? What work was done?" required></textarea>

  <p class="info">GPS must be within parcel boundaries. Photos older than 72 hours will be rejected.</p>

  <button type="submit">Submit Photo</button>
</form>
<div id="result"></div>
</div>

<script>
function setType(t) {
  document.getElementById('subType').value = t;
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('plantFields').style.display = t === 'plant_id' ? 'block' : 'none';
}

// Try to get GPS from device
if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('lat').value = pos.coords.latitude.toFixed(6);
    document.getElementById('lng').value = pos.coords.longitude.toFixed(6);
  });
}

// Default timestamp to now
document.getElementById('timestamp').value = new Date().toISOString().slice(0,16);

document.getElementById('submitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const res = document.getElementById('result');

  try {
    const resp = await fetch('/api/submissions', {
      method: 'POST',
      body: form,
    });
    const data = await resp.json();
    if (data.verified) {
      res.innerHTML = '<div class="success">✅ <strong>Submission verified!</strong><br>Nearest parcel: ' + data.nearestParcel + '<br>Distance: ' + data.distanceMeters.toFixed(0) + 'm<br>ID: ' + data.id + '</div>';
    } else {
      res.innerHTML = '<div class="error">⚠️ <strong>Verification failed:</strong><br>' + data.verificationErrors.join('<br>') + '</div>';
    }
  } catch (err) {
    res.innerHTML = '<div class="error">Error: ' + err.message + '</div>';
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
</style>
</head><body>
<div class="header">
  <h1>🌿 Dryad Dashboard</h1>
  <nav><a href="/">Chat</a><a href="/submit">Submit Photos</a><a href="/dashboard">Dashboard</a></nav>
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

  <!-- Property Tax -->
  <div class="card">
    <h2>Property Tax Estimate</h2>
    <div class="stat-row">
      <div class="stat-item"><div class="stat">~$180</div><div class="stat-label">Annual (9 lots)</div></div>
      <div class="stat-item"><div class="stat">~$20</div><div class="stat-label">Per lot/year</div></div>
    </div>
    <p style="font-size:13px;color:#81c784">Detroit vacant land: ~$500-2000 SEV × 2 × 42.4 mills. Vacant lots typically assessed at minimal value ($200-500 SEV), resulting in ~$15-25/lot/year.</p>
  </div>

  <!-- Milestones -->
  <div class="card">
    <h2>Onchain Milestones</h2>
    <div id="milestones" class="loading">Loading...</div>
  </div>

  <!-- Recent Submissions -->
  <div class="card full">
    <h2>Recent Photo Submissions</h2>
    <div id="submissions" class="loading">Loading...</div>
  </div>

  <!-- Agent Info -->
  <div class="card full">
    <h2>Agent Identity</h2>
    <table>
      <tr><th>Name</th><td>Dryad</td></tr>
      <tr><th>Email</th><td>dryad@agentmail.to</td></tr>
      <tr><th>Wallet</th><td><code id="walletAddr">Loading...</code></td></tr>
      <tr><th>ERC-8004 Agent ID</th><td>#${process.env.ERC8004_AGENT_ID || '35293'} on Base</td></tr>
      <tr><th>Milestones Contract</th><td><code>${process.env.MILESTONES_CONTRACT_ADDRESS || '0x7572dcac88720470d8cc827be5b02d474951bc22'}</code></td></tr>
      <tr><th>Registry</th><td><code>0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</code></td></tr>
    </table>
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

// Load treasury data
fetch('/api/treasury').then(r=>r.json()).then(data => {
  document.getElementById('treasury').innerHTML = \`
    <div class="stat-row">
      <div class="stat-item"><div class="stat">\${data.ethBalance || '—'}</div><div class="stat-label">ETH</div></div>
      <div class="stat-item"><div class="stat">\${data.wstethBalance || '—'}</div><div class="stat-label">wstETH</div></div>
    </div>
    <div class="stat-row">
      <div class="stat-item"><div class="stat">\${data.dailyYieldUSD || '—'}</div><div class="stat-label">Daily Yield (USD)</div></div>
      <div class="stat-item"><div class="stat">\${data.monthlyYieldUSD || '—'}</div><div class="stat-label">Monthly Yield</div></div>
    </div>
    <p style="font-size:13px;color:#81c784">Wallet: <code>\${data.wallet || '—'}</code></p>
  \`;
  document.getElementById('walletAddr').textContent = data.wallet || '—';
}).catch(()=>{ document.getElementById('treasury').textContent = 'Failed to load'; });

// Load health score
fetch('/api/health-score').then(r=>r.json()).then(data => {
  document.getElementById('healthScore').innerHTML = \`
    <div class="stat">\${data.healthScore}/100</div>
    <div class="stat-label">On-parcel observations: \${data.onParcelObservations}</div>
    <div class="stat-label">Native species: \${data.nativeSpeciesCount}</div>
    <div class="stat-label">Invasives detected: \${data.invasiveCount}</div>
  \`;
}).catch(()=>{ document.getElementById('healthScore').textContent = 'Failed to load'; });

// Load milestones
fetch('/api/milestones').then(r=>r.json()).then(data => {
  const types = ['SiteAssessment','InvasiveRemoval','SoilPrep','NativePlanting','Monitoring'];
  const tags = ['assessment','removal','soil','planting','monitoring'];
  if (!data.milestones || data.milestones.length === 0) {
    document.getElementById('milestones').innerHTML = '<p>No milestones recorded yet.</p>';
    return;
  }
  document.getElementById('milestones').innerHTML = data.milestones.map(m =>
    '<div class="milestone"><span class="tag tag-' + tags[m.milestoneType] + '">' + types[m.milestoneType] + '</span> ' + m.parcel + ' — ' + new Date(m.timestamp * 1000).toLocaleDateString() + '</div>'
  ).join('');
}).catch(()=>{ document.getElementById('milestones').textContent = 'Failed to load'; });

// Load submissions
fetch('/api/submissions').then(r=>r.json()).then(data => {
  if (!data.length) { document.getElementById('submissions').innerHTML = '<p>No submissions yet. <a href="/submit">Submit a photo</a></p>'; return; }
  document.getElementById('submissions').innerHTML = data.slice(0,10).map(s =>
    '<div class="sub-item">' +
    '<span class="' + (s.verified ? 'sub-verified' : 'sub-failed') + '">' + (s.verified ? '✅' : '❌') + '</span> ' +
    '<strong>' + s.type + '</strong> at ' + s.nearestParcel +
    (s.species ? ' — ' + s.species : '') +
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
      try {
        // Handle multipart form data
        const contentType = req.headers?.['content-type'] || '';
        let lat: number, lng: number, timestamp: number, type: string, species: string, description: string, photoFilename: string;

        if (contentType.includes('multipart/form-data')) {
          // Parse multipart — elizaOS routes get the raw body
          // For simplicity, also accept JSON
          const body = req.body as any;
          lat = parseFloat(body?.lat || '0');
          lng = parseFloat(body?.lng || '0');
          timestamp = body?.timestamp ? new Date(body.timestamp).getTime() : Date.now();
          type = body?.type || 'plant_id';
          species = body?.species || '';
          description = body?.description || '';
          photoFilename = `photo_${Date.now()}.jpg`;

          // Save photo if present
          if (body?.photo) {
            try {
              const photoPath = path.join(UPLOADS_DIR, photoFilename);
              if (typeof body.photo === 'string') {
                fs.writeFileSync(photoPath, Buffer.from(body.photo, 'base64'));
              }
            } catch {}
          }
        } else {
          const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
          lat = parseFloat(body?.lat || '0');
          lng = parseFloat(body?.lng || '0');
          timestamp = body?.timestamp ? new Date(body.timestamp).getTime() : Date.now();
          type = body?.type || 'plant_id';
          species = body?.species || '';
          description = body?.description || '';
          photoFilename = body?.photoFilename || `photo_${Date.now()}.jpg`;
        }

        const submission = addSubmission({
          type: type as 'plant_id' | 'proof_of_work',
          lat,
          lng,
          timestamp,
          species,
          description,
          photoFilename,
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
      res.json(getAllSubmissions());
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
        const ethPrice = 2500;
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
];
