import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, Loading, Err } from '../App';

const MILESTONE_TYPES = ['Site Assessment', 'Invasive Removal', 'Soil Prep', 'Native Planting', 'Monitoring'];
const MILESTONE_COLORS = ['#1565c0', '#c62828', '#6d4c41', '#2e7d32', '#f9a825'];

export default function MilestonesPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['milestones'],
    queryFn: api.milestones,
    refetchInterval: 5 * 60_000,
  });

  const milestones = data?.milestones ?? [];

  // Count by type
  const counts = MILESTONE_TYPES.map((_, i) => milestones.filter(m => m.milestoneType === i).length);

  return (
    <Card title="Onchain Milestones">
      {isLoading && <Loading />}
      {error && <Err msg="Could not load milestones" />}

      {/* Type totals */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MILESTONE_TYPES.map((label, i) => (
          <div key={label} style={{
            flex: 1, minWidth: 60,
            padding: '6px 10px',
            background: 'var(--bg-card2)',
            border: `1px solid ${MILESTONE_COLORS[i]}40`,
            borderRadius: 6,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: MILESTONE_COLORS[i] }}>{counts[i]}</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.2, marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {milestones.length === 0 && !isLoading && (
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No milestones recorded yet.</div>
      )}

      {/* Timeline */}
      {milestones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
          {milestones.slice(0, 10).map(m => {
            const typeIdx = Math.min(m.milestoneType, MILESTONE_TYPES.length - 1);
            return (
              <div key={m.id} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '6px 0',
                borderBottom: '1px solid var(--border)',
                fontSize: 12,
              }}>
                <span style={{
                  background: MILESTONE_COLORS[typeIdx],
                  color: '#fff',
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  {MILESTONE_TYPES[typeIdx]}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text)' }}>{m.parcel}</div>
                  {m.description && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{m.description}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                    {new Date(m.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {m.recorder && (
                    <a
                      href={`https://basescan.org/tx/${m.dataHash}`}
                      target="_blank" rel="noopener"
                      style={{ fontSize: 10, color: 'var(--text-dim)' }}
                    >
                      Basescan ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        Contract:{' '}
        <a href="https://basescan.org/address/0x7572dcac88720470d8cc827be5b02d474951bc22" target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          0x7572...bc22 ↗
        </a>
      </div>
    </Card>
  );
}
