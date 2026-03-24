import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const SEASON_COLORS: Record<string, string> = {
  DORMANT:      '#455a64',
  EARLY_SPRING: '#66bb6a',
  SPRING:       '#4caf50',
  SUMMER:       '#f9a825',
  FALL:         '#e65100',
};

export default function SeasonWidget() {
  const { data: season } = useQuery({
    queryKey: ['season'],
    queryFn: api.season,
    refetchInterval: 60 * 60 * 1000, // once an hour — season changes slowly
    staleTime: 60 * 60 * 1000,
  });

  if (!season) return null;

  const color = SEASON_COLORS[season.season] || 'var(--green)';

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
      padding: '10px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexWrap: 'wrap',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          background: color,
          color: '#000',
          padding: '2px 10px',
          borderRadius: 4,
          fontWeight: 700,
          letterSpacing: '0.06em',
          fontSize: 11,
        }}>
          {season.season.replace('_', ' ')}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>{season.description}</span>
      </div>
      <div style={{ color: 'var(--text-dim)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {season.priorities.slice(0, 3).map((p: string) => (
          <span key={p}>· {p}</span>
        ))}
        <span style={{ color: season.plantingAppropriate ? 'var(--green)' : 'var(--text-dim)' }}>
          {season.plantingAppropriate ? '🌱 Planting' : '❌ No planting'}
        </span>
      </div>
    </div>
  );
}
