import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, isAuthenticated, setStoredSecret, clearStoredSecret } from './api';
import AgentHealthCard from './components/AgentHealthCard';
import TreasuryCard from './components/TreasuryCard';
import BiodiversityCard from './components/BiodiversityCard';
import ParcelMap from './components/ParcelMap';
import MilestonesPanel from './components/MilestonesPanel';
import SubmissionsPanel from './components/SubmissionsPanel';
import AuditPanel from './components/AuditPanel';
import TransactionTable from './components/TransactionTable';
import SeasonWidget from './components/SeasonWidget';

// ── Shared card shell ─────────────────────────────────────────────────────────
export function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }} className={className}>
      {title && (
        <h2 style={{
          color: 'var(--green)',
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderBottom: '1px solid var(--border)',
          paddingBottom: 8,
          marginBottom: 4,
        }}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export function Stat({ value, label, color }: { value: React.ReactNode; label: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || 'var(--green-lit)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    green:  { bg: '#1b5e20', text: '#a5d6a7' },
    amber:  { bg: '#4a3800', text: '#f9a825' },
    red:    { bg: '#4a1010', text: '#ef9a9a' },
    blue:   { bg: '#0d2c4a', text: '#90caf9' },
    gray:   { bg: '#1a1a1a', text: '#9e9e9e' },
  };
  const c = colors[color || 'green'];
  return (
    <span style={{
      background: c.bg,
      color: c.text,
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}>{label}</span>
  );
}

export function Loading() {
  return <span style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: 13 }}>Loading…</span>;
}

export function Err({ msg }: { msg: string }) {
  return <span style={{ color: 'var(--red)', fontSize: 12 }}>⚠ {msg}</span>;
}

// ── Auth modal ────────────────────────────────────────────────────────────────
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!val.trim()) return;
    setStoredSecret(val.trim());
    // Quick probe to check if secret is valid
    try {
      await api.adminStatus();
      onLogin();
    } catch (e: any) {
      clearStoredSecret();
      setErr('Invalid secret — check ADMIN_SECRET env var');
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        type="password"
        placeholder="Admin secret…"
        value={val}
        onChange={e => setVal(e.target.value)}
        style={{
          background: 'var(--bg-card2)',
          border: '1px solid var(--border-lit)',
          borderRadius: 6,
          color: 'var(--text)',
          padding: '6px 12px',
          fontSize: 13,
          width: 180,
        }}
      />
      <button type="submit" style={{
        background: 'var(--border-lit)',
        color: '#fff',
        border: 'none',
        borderRadius: 6,
        padding: '6px 14px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
      }}>
        Unlock Admin
      </button>
      {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
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
  const modeColor = spendingMode === 'NORMAL' ? 'var(--green)' : spendingMode === 'CONSERVATION' ? 'var(--amber)' : 'var(--red)';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Header ── */}
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ color: 'var(--green)', fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            🌿 Dryad
          </h1>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>dryadforest.eth · ERC-8004 #35293</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Spending mode pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, border: `1px solid ${modeColor}`, background: 'rgba(0,0,0,0.3)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: modeColor, display: 'inline-block' }} />
            <span style={{ color: modeColor, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>{spendingMode}</span>
          </div>

          {/* Nav links */}
          <nav style={{ display: 'flex', gap: 8 }}>
            {[
              ['/', 'Chat'],
              ['/Dryad/submit', 'Submit Work'],
              ['https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping', 'iNaturalist'],
            ].map(([href, label]) => (
              <a key={href} href={href} target={href.startsWith('http') ? '_blank' : undefined} style={{
                color: 'var(--text-muted)',
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 5,
                border: '1px solid var(--border)',
              }}>{label}</a>
            ))}
          </nav>

          {/* Admin auth */}
          {admin ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge label="Admin" color="blue" />
              <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12 }}>
                Sign out
              </button>
            </div>
          ) : (
            <AdminLogin onLogin={handleLogin} />
          )}
        </div>
      </header>

      {/* ── Season banner ── */}
      <SeasonWidget />

      {/* ── Main grid ── */}
      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '20px 20px 60px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
        gap: 16,
      }}>

        {/* Agent Health */}
        <AgentHealthCard />

        {/* Treasury */}
        <TreasuryCard />

        {/* Biodiversity */}
        <BiodiversityCard />

        {/* Milestones */}
        <MilestonesPanel />

        {/* Map — full width */}
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
                  ['Name', 'Dryad — "The Forest That Owns Itself"'],
                  ['ENS', 'dryadforest.eth'],
                  ['Email', 'dryad@agentmail.to'],
                  ['Wallet', summary?.wallet ?? '—'],
                  ['ERC-8004', '#35293 on Base'],
                  ['Milestones', '0x7572dcac88720470d8cc827be5b02d474951bc22'],
                  ['Chain', 'Base L2'],
                  ['Decision loop', 'Every 24 hours'],
                ].map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ color: 'var(--text-muted)', padding: '7px 0', paddingRight: 20, whiteSpace: 'nowrap', fontWeight: 600, width: 150 }}>{k}</td>
                    <td style={{ padding: '7px 0', wordBreak: 'break-all', fontFamily: k === 'Wallet' || k === 'Milestones' ? 'var(--font-mono)' : 'inherit', fontSize: k === 'Wallet' || k === 'Milestones' ? 11 : 13 }}>
                      {k === 'Milestones' ? (
                        <a href={`https://basescan.org/address/${v}`} target="_blank" rel="noopener">{v}</a>
                      ) : k === 'Wallet' && v !== '—' ? (
                        <a href={`https://basescan.org/address/${v}`} target="_blank" rel="noopener">{v}</a>
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
