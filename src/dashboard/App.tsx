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
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }} className={className}>
      {title && (
        <h2 style={{
          color: 'var(--amber)',
          fontSize: 18,
          fontWeight: 400,
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          borderBottom: '1px solid var(--border)',
          paddingBottom: 10,
          marginBottom: 2,
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
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', color: color || 'var(--amber)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
    </div>
  );
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const colors: Record<string, { border: string; text: string }> = {
    green:  { border: 'rgba(141,166,103,0.5)', text: '#a0bb78' },
    amber:  { border: 'rgba(226,158,75,0.5)',  text: '#e29e4b' },
    red:    { border: 'rgba(192,57,43,0.5)',   text: '#e74c3c' },
    blue:   { border: 'rgba(91,141,184,0.5)',  text: '#7aafd4' },
    gray:   { border: 'rgba(210,214,193,0.2)', text: 'rgba(210,214,193,0.5)' },
  };
  const c = colors[color || 'green'];
  return (
    <span style={{
      border: `1px solid ${c.border}`,
      color: c.text,
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 10,
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    }}>{label}</span>
  );
}

export function Loading() {
  return <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>loading…</span>;
}

export function Err({ msg }: { msg: string }) {
  return <span style={{ color: 'var(--red-lit)', fontSize: 12 }}>⚠ {msg}</span>;
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
        placeholder="admin secret"
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
          outline: 'none',
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
  const modeColor = spendingMode === 'NORMAL' ? 'var(--green)' : spendingMode === 'CONSERVATION' ? 'var(--amber)' : 'var(--red)';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Header ── */}
      <header style={{
        background: 'rgba(26, 28, 20, 0.97)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(141, 166, 103, 0.2)',
        padding: '0 28px',
        height: 52,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <a href="https://dryad.vercel.app" style={{ color: 'var(--green)', fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '-0.01em' }}>
            dryad
          </a>
          <a href="https://dryad.vercel.app" style={{
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Spending mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: modeColor, display: 'inline-block' }} />
            <span style={{ color: modeColor, fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{spendingMode}</span>
          </div>

          {/* Nav links */}
          <nav style={{ display: 'flex', gap: 20 }}>
            {[
              ['/', 'Chat'],
              ['/Dryad/submit', 'Submit Work'],
              ['https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping', 'iNaturalist'],
            ].map(([href, label]) => (
              <a key={href} href={href} target={href.startsWith('http') ? '_blank' : undefined} style={{
                color: 'rgba(210, 214, 193, 0.55)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}>{label}</a>
            ))}
          </nav>

          {/* Admin auth */}
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
      </header>

      {/* ── Season banner ── */}
      <SeasonWidget />

      {/* ── Main grid ── */}
      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '28px 28px 80px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap: 20,
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
                    <td style={{ color: 'var(--text-dim)', padding: '8px 0', paddingRight: 24, whiteSpace: 'nowrap', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', width: 150 }}>{k}</td>
                    <td style={{ padding: '8px 0', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
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
