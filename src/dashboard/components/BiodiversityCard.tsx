import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { Card, Stat, Badge, Loading, Err } from '../App';

function HealthRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? '#4caf50' : score >= 40 ? '#f9a825' : '#ef5350';
  return (
    <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
      <svg width={72} height={72}>
        <circle cx={36} cy={36} r={r} fill="none" stroke="var(--border)" strokeWidth={5} />
        <circle
          cx={36} cy={36} r={r} fill="none"
          stroke={color} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>/100</span>
      </div>
    </div>
  );
}

export default function BiodiversityCard() {
  const { data: trend, isLoading, error } = useQuery({
    queryKey: ['health-trend'],
    queryFn: () => api.healthTrend(30),
    refetchInterval: 5 * 60_000,
  });

  const latest = trend?.latest;
  const history = trend?.history ?? [];

  const chartData = [...history].reverse().map(s => ({
    date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: s.healthScore,
    p1: s.invasivesP1,
  }));

  const p1 = latest?.invasivesP1 ?? 0;
  const p2 = latest?.invasivesP2 ?? 0;
  const p3 = latest?.invasivesP3 ?? 0;
  const total = p1 + p2 + p3;

  return (
    <Card title="Ecosystem Health">
      {isLoading && <Loading />}
      {error && (error as Error).message !== 'ROUTE_NOT_DEPLOYED' && <Err msg="Could not load biodiversity data" />}

      {latest && (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <HealthRing score={latest.healthScore} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Stat value={latest.observationsTotal} label="On-parcel obs" />
                <Stat value={latest.nativeSpeciesCount} label="Native species" color="var(--green-lit)" />
              </div>
            </div>
          </div>

          {/* Invasives breakdown */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Invasive species — {total} detected
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div style={{
                flex: 1, minWidth: 80, padding: '8px 12px',
                background: p1 > 0 ? '#4a1010' : 'var(--bg-card2)',
                border: `1px solid ${p1 > 0 ? 'var(--red)' : 'var(--border)'}`,
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: p1 > 0 ? 'var(--red)' : 'var(--text-dim)' }}>{p1}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>P1 Woody</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>contractor needed</div>
              </div>
              <div style={{
                flex: 1, minWidth: 80, padding: '8px 12px',
                background: p2 > 0 ? '#4a3800' : 'var(--bg-card2)',
                border: `1px solid ${p2 > 0 ? 'var(--amber)' : 'var(--border)'}`,
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: p2 > 0 ? 'var(--amber)' : 'var(--text-dim)' }}>{p2}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>P2 Herbaceous</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>monitor closely</div>
              </div>
              <div style={{
                flex: 1, minWidth: 80, padding: '8px 12px',
                background: p3 > 0 ? '#1a2a00' : 'var(--bg-card2)',
                border: `1px solid ${p3 > 0 ? '#8bc34a' : 'var(--border)'}`,
                borderRadius: 6,
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: p3 > 0 ? '#8bc34a' : 'var(--text-dim)' }}>{p3}</div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>P3 Tree of Heaven</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>assess & plan</div>
              </div>
            </div>
          </div>

          {/* Species detected */}
          {latest.invasiveSpecies?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Active invasives:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {latest.invasiveSpecies.map(s => (
                  <span key={s} style={{
                    background: '#4a1010', color: '#ef9a9a',
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  }}>{s}</span>
                ))}
              </div>
            </div>
          )}
          {latest.invasiveSpecies?.length === 0 && (
            <div style={{ color: 'var(--green)', fontSize: 13 }}>✓ No invasives detected on parcels</div>
          )}
        </>
      )}

      {/* Health score trend */}
      {chartData.length > 1 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Health score trend</div>
          <ResponsiveContainer width="100%" height={70}>
            <LineChart data={chartData}>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                formatter={(v: any, name: string) => [name === 'score' ? `${v}/100` : v, name === 'score' ? 'Health' : 'P1 invasives']}
              />
              <Line type="monotone" dataKey="score" stroke="#4caf50" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="p1" stroke="#ef5350" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
