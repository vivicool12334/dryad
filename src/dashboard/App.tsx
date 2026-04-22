import { useState, useCallback, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isAuthenticated, setStoredSecret, clearStoredSecret } from './api';
import { Badge, Card } from './components/ui';
import AgentHealthCard from './components/AgentHealthCard';
import TreasuryCard from './components/TreasuryCard';
import BiodiversityCard from './components/BiodiversityCard';
import ParcelMap from './components/ParcelMap';
import MilestonesPanel from './components/MilestonesPanel';
import SubmissionsPanel from './components/SubmissionsPanel';
import AuditPanel from './components/AuditPanel';
import TransactionTable from './components/TransactionTable';
import DefiAllocationsCard from './components/DefiAllocationsCard';
import SeasonWidget from './components/SeasonWidget';
import { NAV_LINKS, SITE_URL, MILESTONES_CONTRACT_ADDRESS, toBasescanAddressUrl } from './lib/links';
import { SPENDING_MODE_META } from '../shared/treasuryMode';

// ── Auth modal ────────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!val.trim()) return;
    setStoredSecret(val.trim());
    // Quick probe to check if secret is valid
    try {
      await api.adminStatus();
      onLogin();
    } catch {
      clearStoredSecret();
      setErr('Invalid secret - check ADMIN_SECRET env var');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <label htmlFor="admin-secret" className="sr-only">Admin secret</label>
      <input
        id="admin-secret"
        type="password"
        placeholder="admin secret"
        aria-label="Admin secret"
        value={val}
        onChange={e => setVal(e.target.value)}
        style={{
          background: 'transparent',
          border: '1px solid var(--border-lit)',
          borderRadius: 4,
          color: 'var(--text)',
          padding: '5px 10px',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          width: 160,
        }}
      />
      <button type="submit" style={{
        background: 'transparent',
        color: 'var(--amber)',
        border: '1px solid var(--amber)',
        borderRadius: 4,
        padding: '5px 12px',
        cursor: 'pointer',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        Unlock
      </button>
      {err && <span style={{ color: 'var(--red-lit)', fontSize: 11 }}>{err}</span>}
    </form>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [admin, setAdmin] = useState(isAuthenticated);

  const handleLogin = useCallback(() => setAdmin(true), []);
  const handleLogout = useCallback(() => { clearStoredSecret(); setAdmin(false); }, []);

  const { data: summary } = useQuery({
    queryKey: ['summary'],
    queryFn: api.summary,
    refetchInterval: 30_000,
  });

  const spendingMode = summary?.treasury?.spendingMode ?? 'NORMAL';
  const modeColor = SPENDING_MODE_META[spendingMode].cssColor;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* Skip-to-content for keyboard accessibility */}
      <a href="#dashboard-main" style={{
        position: 'absolute', top: -40, left: 0, background: 'var(--green)', color: '#fff',
        padding: '8px 16px', zIndex: 200, fontWeight: 600, borderRadius: '0 0 8px 0', fontSize: 13,
      }} onFocus={e => { e.currentTarget.style.top = '0'; }}
         onBlur={e => { e.currentTarget.style.top = '-40px'; }}>
        Skip to dashboard
      </a>
      {/* ── Header ── */}
      <header style={{
        background: 'rgba(26, 28, 20, 0.97)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(141, 166, 103, 0.2)',
        padding: '0 28px',
        minHeight: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        {/* Left: logo + back link */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '10px 0' }}>
          <a href={SITE_URL} style={{ color: 'var(--green)', fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '-0.01em' }}>
            dryad
          </a>
          <a href={SITE_URL} style={{
            color: 'var(--amber)',
            border: '1px solid var(--amber)',
            borderRadius: 4,
            padding: '3px 10px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>← Site</a>
          <span style={{ color: 'var(--text-dim)', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Dashboard</span>
        </div>

        {/* Right: spending mode + nav + admin */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0' }}>
          {/* Spending mode */}
          <div className="header-mode" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: modeColor, display: 'inline-block' }} />
            <span style={{ color: modeColor, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{spendingMode}</span>
          </div>

          {/* Nav links */}
          <nav className="header-nav" role="navigation" aria-label="Site navigation" style={{ display: 'flex', gap: 20 }}>
            {NAV_LINKS.map(({ href, label }) => (
              <a key={href} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noopener noreferrer' : undefined} style={{
                color: 'rgba(210, 214, 193, 0.55)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>{label}</a>
            ))}
          </nav>

          {/* Admin auth */}
          <div className="header-admin">
            {admin ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Badge label="Admin" color="amber" />
                <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                  sign out
                </button>
              </div>
            ) : (
              <AdminLogin onLogin={handleLogin} />
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile nav (visible below 700px when header nav is hidden) ── */}
      <nav className="mobile-nav" style={{ display: 'none', gap: 6, padding: '10px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', overflowX: 'auto', whiteSpace: 'nowrap' as const }}>
        {NAV_LINKS.map(({ label, href }) => (
          <a key={href} href={href} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'var(--font-mono)', textDecoration: 'none', flexShrink: 0 }}>{label}</a>
        ))}
      </nav>

      {/* ── Season banner ── */}
      <SeasonWidget />

      {/* ── Main grid ── */}
      <main id="dashboard-main" className="dashboard-grid" style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '28px 28px 80px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: 20,
      }}>

        {/* Agent Health */}
        <AgentHealthCard />

        {/* Treasury */}
        <TreasuryCard />

        {/* DeFi Allocations */}
        <DefiAllocationsCard />

        {/* Biodiversity */}
        <BiodiversityCard />

        {/* Milestones */}
        <MilestonesPanel />

        {/* Map - full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <ParcelMap />
        </div>

        {/* Submissions */}
        <div style={{ gridColumn: '1 / -1' }}>
          <SubmissionsPanel />
        </div>

        {/* Admin-only panels */}
        {admin && (
          <>
            <div style={{ gridColumn: '1 / -1' }}>
              <TransactionTable />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <AuditPanel />
            </div>
          </>
        )}

        {/* Agent identity footer card */}
        <div style={{ gridColumn: '1 / -1' }}>
          <Card title="Agent Identity">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {[
                  ['Name', 'Dryad - "The Forest That Owns Itself"'],
                  ['ENS', 'dryadforest.eth'],
                  ['Email', 'dryad@agentmail.to'],
                  ['Wallet', summary?.wallet ?? '0xf2f7527D86e2173c91fF1c10Ede03f6f84510880'],
                  ['ERC-8004', '#35293 on Base'],
                  ['Milestones', MILESTONES_CONTRACT_ADDRESS],
                  ['Chain', 'Base L2'],
                  ['Decision loop', 'Every 24 hours'],
                ].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ color: 'var(--text-dim)', padding: '8px 0', paddingRight: 24, whiteSpace: 'nowrap', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', width: 150 }}>{k}</td>
                    <td style={{ padding: '8px 0', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {k === 'Milestones' ? (
                        <a href={toBasescanAddressUrl(String(v))} target="_blank" rel="noopener noreferrer">{v}</a>
                      ) : k === 'Wallet' && v !== '-' ? (
                        <a href={toBasescanAddressUrl(String(v))} target="_blank" rel="noopener noreferrer">{v}</a>
                      ) : v}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </main>
    </div>
  );
}
