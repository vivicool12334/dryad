/**
 * Dryad Demo Proof Report Generator
 *
 * Generates a single self-contained HTML file that proves every critical claim
 * about the Dryad autonomous agent. Reads from:
 *   - Event collector (demo timeline)
 *   - Audit log (data/audit-log.jsonl)
 *   - Loop history (data/loop-history.jsonl)
 *   - Treasury snapshots (data/treasury-snapshots.jsonl)
 *   - Health snapshots (data/health-snapshots.jsonl)
 *
 * The output is a single .html file with embedded CSS - no external deps.
 * Drop it in an email, host it on IPFS, or open it locally.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getAllEvents, getScenarioResults, type DemoConfigSummary, type DemoEvent, type SecurityTestResult } from './eventCollector.ts';
import { TIMING, TX_LIMITS, FINANCIAL, CHAIN, DEMO_MODE } from '../config/constants.ts';
import { getErrorMessage, isFileNotFoundError } from '../utils/fileErrors.ts';
import type { AuditEntry } from '../services/auditLog.ts';
import type { LoopHistoryEntry } from '../services/loopHistory.ts';
import type { TreasurySnapshot } from '../services/treasurySnapshots.ts';
import type { HealthSnapshot } from '../services/healthSnapshots.ts';

function readJsonl<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as T);
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw new Error(`Failed to read report data from ${filePath}: ${getErrorMessage(error)}`);
  }
}

function isConfigSummaryEvent(event: DemoEvent): event is DemoEvent<'config_summary'> {
  return event.type === 'config_summary';
}

function isSecurityTestEvent(event: DemoEvent): event is DemoEvent<'security_test'> {
  return event.type === 'security_test';
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function relativeTime(ts: number, base: number): string {
  const diff = (ts - base) / 1000;
  if (diff < 60) return `+${diff.toFixed(1)}s`;
  return `+${(diff / 60).toFixed(1)}m`;
}

export function generateProofReport(): string {
  const events = getAllEvents();
  const scenarios = getScenarioResults();
  const dataDir = path.join(process.cwd(), 'data');

  const auditLog = readJsonl<AuditEntry>(path.join(dataDir, 'audit-log.jsonl'));
  const loopHistory = readJsonl<LoopHistoryEntry>(path.join(dataDir, 'loop-history.jsonl'));
  const treasurySnaps = readJsonl<TreasurySnapshot>(path.join(dataDir, 'treasury-snapshots.jsonl'));
  const healthSnaps = readJsonl<HealthSnapshot>(path.join(dataDir, 'health-snapshots.jsonl'));

  const demoStart = events.find(e => e.type === 'demo_start')?.timestamp || Date.now();
  const demoEnd = events.find(e => e.type === 'demo_end')?.timestamp || Date.now();
  const durationSec = (demoEnd - demoStart) / 1000;

  const configEvent = events.find(isConfigSummaryEvent);
  const config: Partial<DemoConfigSummary> = configEvent?.data ?? {};

  // Build security test results
  const securityEvent = events.find(isSecurityTestEvent);
  const securityTests: SecurityTestResult[] = securityEvent?.data.tests ?? [];

  // Count key metrics
  const loopsRun = loopHistory.length;
  const loopSuccesses = loopHistory.filter((l) => l.status === 'success').length;
  const totalAuditEvents = auditLog.length;
  const visionEvents = auditLog.filter((a) => a.type === 'VISION_VERIFY' || a.type === 'VISION_VERIFY_COMPARE');
  const emailEvents = auditLog.filter((a) => a.type === 'EMAIL_SENT');
  const modeChanges = auditLog.filter((a) => a.type === 'TREASURY_MODE_CHANGE');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dryad Demo Proof Report - ${formatDate(demoStart)}</title>
<style>
  :root {
    --bg: #0d0f09;
    --bg-card: #141610;
    --bg-card-alt: #1a1c14;
    --border: rgba(141,166,103,0.15);
    --border-lit: rgba(141,166,103,0.3);
    --green: #8da667;
    --green-bright: #a3c270;
    --amber: #d4a574;
    --red: #c75050;
    --text: #c8cbb8;
    --text-dim: #7a7d6e;
    --text-bright: #e8ebd8;
    --font-sans: 'Inter', -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
    --font-serif: 'Playfair Display', Georgia, serif;
    --radius: 8px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }
  .container { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
  h1 { color: var(--green-bright); font-family: var(--font-serif); font-weight: 400; font-size: 28px; margin-bottom: 4px; }
  h2 { color: var(--amber); font-family: var(--font-serif); font-weight: 400; font-size: 20px; font-style: italic; margin: 32px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  h3 { color: var(--green); font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin: 20px 0 8px; }
  .subtitle { color: var(--text-dim); font-size: 13px; margin-bottom: 24px; }
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 20px;
    margin: 12px 0;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .badge-pass { background: rgba(141,166,103,0.15); color: var(--green-bright); border: 1px solid rgba(141,166,103,0.3); }
  .badge-fail { background: rgba(199,80,80,0.15); color: var(--red); border: 1px solid rgba(199,80,80,0.3); }
  .badge-info { background: rgba(212,165,116,0.15); color: var(--amber); border: 1px solid rgba(212,165,116,0.3); }
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin: 16px 0;
  }
  .metric {
    background: var(--bg-card-alt);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 16px;
    text-align: center;
  }
  .metric-value { font-size: 24px; font-weight: 700; font-family: var(--font-mono); color: var(--green-bright); }
  .metric-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
  .timeline {
    position: relative;
    padding-left: 24px;
    margin: 12px 0;
  }
  .timeline::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 4px;
    bottom: 4px;
    width: 1px;
    background: var(--border-lit);
  }
  .timeline-event {
    position: relative;
    padding: 6px 0 6px 16px;
    font-size: 13px;
  }
  .timeline-event::before {
    content: '';
    position: absolute;
    left: -20px;
    top: 12px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--green);
    border: 2px solid var(--bg);
  }
  .timeline-event.blocked::before { background: var(--red); }
  .timeline-event.warn::before { background: var(--amber); }
  .timeline-ts {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
    min-width: 60px;
    display: inline-block;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
  th { text-align: left; font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.06em; padding: 6px 8px; border-bottom: 1px solid var(--border-lit); }
  td { padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--text); vertical-align: top; }
  td.mono { font-family: var(--font-mono); font-size: 12px; }
  .pass { color: var(--green-bright); }
  .fail { color: var(--red); }
  .warn { color: var(--amber); }
  .code { font-family: var(--font-mono); font-size: 12px; background: var(--bg-card-alt); padding: 2px 6px; border-radius: 3px; }
  .footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    text-align: center;
    font-size: 12px;
    color: var(--text-dim);
  }
  .scenario-card {
    border-left: 3px solid var(--green);
    margin: 16px 0;
  }
  .scenario-card.failed { border-left-color: var(--red); }
  .header-banner {
    background: linear-gradient(135deg, #1a1c14 0%, #0d0f09 100%);
    border: 1px solid var(--border-lit);
    border-radius: var(--radius);
    padding: 24px;
    margin-bottom: 24px;
    text-align: center;
  }
  .proof-hash {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-dim);
    word-break: break-all;
    margin-top: 8px;
  }
  details { margin: 4px 0; }
  details summary {
    cursor: pointer;
    color: var(--amber);
    font-size: 12px;
    font-family: var(--font-mono);
  }
  details > div { padding: 8px 0 8px 16px; }
  .config-table td:first-child { color: var(--text-dim); font-size: 12px; width: 200px; }
  .config-table td:last-child { font-family: var(--font-mono); font-size: 13px; color: var(--green-bright); }
</style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header-banner">
    <h1>Dryad Autonomous Agent - Proof Report</h1>
    <p class="subtitle">
      Generated ${formatDate(demoStart)} at ${formatTime(demoStart)} ET &middot;
      Demo duration: ${durationSec.toFixed(0)}s &middot;
      ${loopsRun} decision cycles &middot;
      ${totalAuditEvents} audit events
    </p>
    <div class="proof-hash">
      Report ID: demo-${demoStart}-${Math.random().toString(36).substring(2, 10)}
    </div>
  </div>

  <!-- Executive Summary -->
  <h2>Executive Summary</h2>
  <p style="margin-bottom: 16px; color: var(--text);">
    This report was generated by running the Dryad autonomous agent in demo mode with
    scaled-down parameters (1000x reduction in financial values, 2-minute decision cycles).
    The agent executed its full autonomous decision loop - the same code that runs in production -
    and every scenario below was driven by the real orchestration logic, not by calling functions in isolation.
  </p>

  <div class="metric-grid">
    <div class="metric">
      <div class="metric-value">${loopsRun}</div>
      <div class="metric-label">Decision Cycles</div>
    </div>
    <div class="metric">
      <div class="metric-value">${loopSuccesses}/${loopsRun}</div>
      <div class="metric-label">Cycles Passed</div>
    </div>
    <div class="metric">
      <div class="metric-value">${visionEvents.length}</div>
      <div class="metric-label">Photos Verified</div>
    </div>
    <div class="metric">
      <div class="metric-value">${emailEvents.length}</div>
      <div class="metric-label">Emails Sent</div>
    </div>
    <div class="metric">
      <div class="metric-value">${securityTests.filter((t) => t.blocked).length}</div>
      <div class="metric-label">Transactions Blocked</div>
    </div>
    <div class="metric">
      <div class="metric-value">${modeChanges.length}</div>
      <div class="metric-label">Mode Transitions</div>
    </div>
  </div>

  <!-- Demo Configuration -->
  <h2>Demo Configuration</h2>
  <div class="card">
    <table class="config-table">
      <tr><td>Decision loop interval</td><td>${config.cycleIntervalSec || 120}s (production: 86,400s / 24h)</td></tr>
      <tr><td>Max per-transaction</td><td>$${(config.maxPerTxUsd || 0.05).toFixed(3)} (production: $50)</td></tr>
      <tr><td>Max daily spend</td><td>$${(config.maxDailyUsd || 0.2).toFixed(3)} (production: $200)</td></tr>
      <tr><td>Treasury target</td><td>$${(config.sustainabilityTarget || 27).toFixed(2)} (production: $27,000)</td></tr>
      <tr><td>Annual operating cost</td><td>$${(config.annualOperatingCost || 0.945).toFixed(3)} (production: $945)</td></tr>
      <tr><td>stETH APR</td><td>${((config.stethApr || 0.035) * 100).toFixed(1)}% (same in both modes)</td></tr>
      <tr><td>Chain</td><td>${config.chain || 'Base Sepolia (testnet)'}</td></tr>
      <tr><td>Cooling-off period</td><td>${(config.coolingOffMin || 2).toFixed(0)} min (production: 1,440 min / 24h)</td></tr>
    </table>
  </div>

  <!-- Decision Loop Results -->
  <h2>Decision Loop Execution</h2>
  <p style="margin-bottom: 12px;">Each row is one complete autonomous cycle. The agent ran these on its own timer - no human triggered them.</p>
  ${loopHistory.length > 0 ? `
  <div class="card">
    <table>
      <thead>
        <tr><th>Cycle</th><th>Status</th><th>Duration</th><th>Season</th><th>Steps</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${loopHistory.map((l, i: number) => `
        <tr>
          <td class="mono">#${i + 1}</td>
          <td><span class="badge ${l.status === 'success' ? 'badge-pass' : 'badge-fail'}">${l.status}</span></td>
          <td class="mono">${(l.durationMs / 1000).toFixed(1)}s</td>
          <td>${escapeHtml(l.season || '-')}</td>
          <td class="mono">${l.steps?.length || 0}</td>
                  <td>${(l.actionsTriggered || []).map((a: string) => `<span class="code">${escapeHtml(a)}</span>`).join(' ') || '-'}</td>
                </tr>
                ${l.steps?.length ? `
                <tr><td colspan="6">
                  <details><summary>Step details</summary><div>
                    <table>
                      <thead><tr><th>Step</th><th>Status</th><th>Duration</th><th>Result</th></tr></thead>
                      <tbody>
                ${l.steps.map((s) => `
                <tr>
                  <td class="mono">${escapeHtml(s.name)}</td>
                  <td><span class="${s.status === 'ok' ? 'pass' : s.status === 'error' ? 'fail' : 'warn'}">${s.status}</span></td>
                  <td class="mono">${s.durationMs}ms</td>
                  <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((s.result || '').substring(0, 200))}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div></details>
        </td></tr>` : ''}
        `).join('')}
      </tbody>
    </table>
  </div>` : '<div class="card"><p style="color:var(--text-dim)">No loop history recorded yet.</p></div>'}

  <!-- Security Guardrails -->
  <h2>Security Guardrail Tests</h2>
  <p style="margin-bottom: 12px;">These tests prove the transaction guard blocks unauthorized, oversized, and rapid-fire payments.</p>
  ${securityTests.length > 0 ? `
  <div class="card">
    <table>
      <thead>
        <tr><th>Test</th><th>Amount</th><th>Result</th><th>Status</th></tr>
      </thead>
      <tbody>
        ${securityTests.map((t) => `
        <tr class="${t.blocked ? '' : ''}">
          <td>${escapeHtml(t.name)}</td>
          <td class="mono">$${t.amount.toFixed(4)}</td>
          <td style="max-width:300px;font-size:12px;">${escapeHtml(t.result)}</td>
          <td><span class="badge ${t.blocked ? 'badge-pass' : 'badge-info'}">${t.blocked ? 'BLOCKED' : 'ALLOWED'}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : '<div class="card"><p style="color:var(--text-dim)">Security tests not yet run.</p></div>'}

  <!-- Vision Verification -->
  <h2>Vision Verification Results</h2>
  <p style="margin-bottom: 12px;">The agent uses a vision LLM to verify contractor proof-of-work photos. Good work is approved and paid; bad work is rejected with specific feedback.</p>
  ${visionEvents.length > 0 ? `
  <div class="card">
    <table>
      <thead>
        <tr><th>Time</th><th>Type</th><th>Details</th><th>Severity</th></tr>
      </thead>
      <tbody>
        ${visionEvents.map((v) => `
        <tr>
          <td class="mono">${formatTime(new Date(v.timestamp).getTime())}</td>
          <td class="mono">${escapeHtml(v.type)}</td>
          <td style="max-width:500px;">${escapeHtml(v.details)}</td>
          <td><span class="${v.severity === 'warn' ? 'warn' : 'pass'}">${v.severity}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : '<div class="card"><p style="color:var(--text-dim)">No vision verification events yet.</p></div>'}

  <!-- Treasury -->
  <h2>Treasury Snapshots</h2>
  <p style="margin-bottom: 12px;">The agent monitors its treasury each cycle and adjusts spending mode based on yield sustainability.</p>
  ${treasurySnaps.length > 0 ? `
  <div class="card">
    <table>
      <thead>
        <tr><th>Time</th><th>wstETH</th><th>ETH Price</th><th>Est. USD</th><th>Annual Yield</th><th>Mode</th></tr>
      </thead>
      <tbody>
        ${treasurySnaps.map((t) => `
        <tr>
          <td class="mono">${formatTime(t.timestamp)}</td>
          <td class="mono">${parseFloat(t.wstEthBalance || '0').toFixed(4)}</td>
          <td class="mono">$${(t.ethPriceUsd || 0).toLocaleString()}</td>
          <td class="mono">$${(t.estimatedUsd || 0).toFixed(2)}</td>
          <td class="mono">$${(t.annualYieldUsd || 0).toFixed(3)}/yr</td>
          <td><span class="badge ${t.spendingMode === 'NORMAL' ? 'badge-pass' : t.spendingMode === 'CONSERVATION' ? 'badge-info' : 'badge-fail'}">${t.spendingMode}</span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : '<div class="card"><p style="color:var(--text-dim)">No treasury snapshots yet.</p></div>'}

  <!-- Biodiversity -->
  <h2>Ecosystem Health Snapshots</h2>
  ${healthSnaps.length > 0 ? `
  <div class="card">
    <table>
      <thead>
        <tr><th>Time</th><th>Health</th><th>P1 Invasives</th><th>P2</th><th>P3</th><th>Native Spp.</th><th>Indicators</th><th>Season</th></tr>
      </thead>
      <tbody>
        ${healthSnaps.map((h) => `
        <tr>
          <td class="mono">${formatTime(h.timestamp)}</td>
          <td class="mono" style="color: ${h.healthScore >= 70 ? 'var(--green-bright)' : h.healthScore >= 40 ? 'var(--amber)' : 'var(--red)'};">${h.healthScore}/100</td>
          <td class="mono fail">${h.invasivesP1}</td>
          <td class="mono warn">${h.invasivesP2}</td>
          <td class="mono">${h.invasivesP3}</td>
          <td class="mono pass">${h.nativeSpeciesCount}</td>
          <td class="mono">${h.nativeIndicatorCount}</td>
          <td>${escapeHtml(h.season)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : '<div class="card"><p style="color:var(--text-dim)">No health snapshots yet.</p></div>'}

  <!-- Full Audit Log -->
  <h2>Audit Log (Last 50 Events)</h2>
  <div class="card">
    ${auditLog.length > 0 ? `
    <table>
      <thead>
        <tr><th>Time</th><th>Type</th><th>Severity</th><th>Details</th></tr>
      </thead>
      <tbody>
        ${auditLog.slice(-50).map((a) => `
        <tr>
          <td class="mono" style="white-space:nowrap;">${escapeHtml((a.timestamp || '').substring(11, 19))}</td>
          <td class="mono" style="white-space:nowrap;font-size:11px;">${escapeHtml(a.type)}</td>
          <td><span class="${a.severity === 'critical' ? 'fail' : a.severity === 'warn' ? 'warn' : 'pass'}">${a.severity}</span></td>
          <td style="max-width:500px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((a.details || '').substring(0, 200))}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p style="color:var(--text-dim)">No audit events yet.</p>'}
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>
      <strong>Dryad</strong> - Autonomous Land Management Agent &middot; ERC-8004 #35293 &middot; dryadforest.eth
    </p>
    <p style="margin-top: 4px;">
      9 vacant lots at 4475–4523 25th Street, Detroit MI &middot; Chadsey-Condon neighborhood
    </p>
    <p style="margin-top: 8px;">
      Report generated by demo mode. All financial values are scaled down 1000x.
      The decision logic, security guardrails, and autonomous orchestration are identical to production.
    </p>
    <p style="margin-top: 8px; font-family: var(--font-mono); font-size: 11px;">
      github.com/dryadforest &middot; dryad.vercel.app &middot; ${formatDate(demoStart)}
    </p>
  </div>

</div>
</body>
</html>`;

  // Write the report
  const outDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filename = `dryad-proof-report-${new Date().toISOString().split('T')[0]}.html`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, html);

  console.log(`\n  Proof report saved: ${outPath}\n`);
  return outPath;
}
