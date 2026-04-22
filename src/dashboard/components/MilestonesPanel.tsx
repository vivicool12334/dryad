import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, Loading, Err } from './ui';
import { formatLongDate } from '../lib/formatting';
import { MILESTONES_CONTRACT_ADDRESS, toBasescanAddressUrl } from '../lib/links';
import { MILESTONE_DEFINITIONS, getMilestoneDefinition } from '../../shared/milestones';

export default function MilestonesPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['milestones'],
    queryFn: api.milestones,
    refetchInterval: 5 * 60_000,
  });

  const milestones = data?.milestones ?? [];

  // Count by type
  const counts = MILESTONE_DEFINITIONS.map((_, i) => milestones.filter(m => m.milestoneType === i).length);

  return (
    <Card title="Onchain Milestones">
      {isLoading && <Loading />}
      {error && (error as Error).message !== 'ROUTE_NOT_DEPLOYED' && <Err msg="Could not load milestones" />}

      {/* Type totals */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MILESTONE_DEFINITIONS.map(({ label, color }, i) => (
          <div key={label} style={{
            flex: 1, minWidth: 60,
            padding: '6px 10px',
            background: 'var(--bg-card2)',
            border: `1px solid ${color}40`,
            borderRadius: 6,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color }}>{counts[i]}</div>
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
            const milestone = getMilestoneDefinition(m.milestoneType);
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
                  background: milestone.color,
                  color: '#fff',
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  {milestone.label}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--text)' }}>{m.parcel}</div>
                  {m.description && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{m.description}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                  <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>
                    {formatLongDate(m.timestamp * 1000)}
                  </span>
                  {m.recorder && (
                    <a
                      href={toBasescanAddressUrl(m.recorder)}
                      target="_blank" rel="noopener"
                      style={{ fontSize: 10, color: 'var(--text-dim)' }}
                    >
                      Recorder ↗
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
        <a href={toBasescanAddressUrl(MILESTONES_CONTRACT_ADDRESS)} target="_blank" rel="noopener" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          {MILESTONES_CONTRACT_ADDRESS.slice(0, 6)}...{MILESTONES_CONTRACT_ADDRESS.slice(-4)} ↗
        </a>
      </div>
    </Card>
  );
}
