import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

const SEASON_COLORS: Record<string, string> = {
  DORMANT:      'rgba(210,214,193,0.3)',
  EARLY_SPRING: 'rgba(141,166,103,0.7)',
  SPRING:       '#8da667',
  SUMMER:       '#e29e4b',
  FALL:         '#c0712a',
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
      borderBottom: '1px solid var(--border)',
      padding: '8px 28px',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexWrap: 'wrap',
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
    }}>
      <span style={{
        border: `1px solid ${color}`,
        color: color,
        padding: '1px 8px',
        borderRadius: 3,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontSize: 10,
      }}>
        {season.season.replace('_', ' ')}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>{season.description}</span>
      <div style={{ color: 'var(--text-dim)', display: 'flex', gap: 14, flexWrap: 'wrap', marginLeft: 'auto' }}>
        {season.priorities.slice(0, 3).map((p: string) => (
          <span key={p}>{p}</span>
        ))}
        <span style={{ color: season.plantingAppropriate ? 'var(--green)' : 'var(--text-dim)' }}>
          {season.plantingAppropriate ? 'planting ✓' : 'no planting'}
        </span>
      </div>
    </div>
  );
}
