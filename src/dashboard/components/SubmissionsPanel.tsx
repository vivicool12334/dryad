import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, Badge, Loading, Err } from '../App';

export default function SubmissionsPanel() {
  const [filter, setFilter] = useState<'all' | 'verified' | 'proof_of_work' | 'plant_id'>('all');

  const { data: submissions, isLoading, error } = useQuery({
    queryKey: ['submissions'],
    queryFn: api.submissions,
    refetchInterval: 30_000,
  });

  const all = submissions ?? [];
  const filtered = all.filter(s => {
    if (filter === 'verified') return s.verified;
    if (filter === 'proof_of_work') return s.type === 'proof_of_work';
    if (filter === 'plant_id') return s.type === 'plant_id';
    return true;
  });

  const verifiedCount = all.filter(s => s.verified).length;
  const proofCount = all.filter(s => s.type === 'proof_of_work').length;
  const plantCount = all.filter(s => s.type === 'plant_id').length;
  const unprocessed = all.filter(s => !s.processed).length;

  return (
    <Card title="Contractor & Community Submissions">
      {isLoading && <Loading />}
      {error && <Err msg="Could not load submissions" />}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
        <span><strong style={{ color: 'var(--green-lit)' }}>{all.length}</strong> <span style={{ color: 'var(--text-dim)' }}>total</span></span>
        <span><strong style={{ color: 'var(--green)' }}>{verifiedCount}</strong> <span style={{ color: 'var(--text-dim)' }}>verified</span></span>
        <span><strong style={{ color: 'var(--blue)' }}>{proofCount}</strong> <span style={{ color: 'var(--text-dim)' }}>proof-of-work</span></span>
        <span><strong style={{ color: 'var(--green-lit)' }}>{plantCount}</strong> <span style={{ color: 'var(--text-dim)' }}>plant IDs</span></span>
        {unprocessed > 0 && <span><strong style={{ color: 'var(--amber)' }}>{unprocessed}</strong> <span style={{ color: 'var(--text-dim)' }}>pending review</span></span>}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['all', 'verified', 'proof_of_work', 'plant_id'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? 'var(--border-lit)' : 'var(--bg-card2)',
              color: filter === f ? '#fff' : 'var(--text-dim)',
              border: `1px solid ${filter === f ? 'var(--border-lit)' : 'var(--border)'}`,
              borderRadius: 5,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: filter === f ? 700 : 400,
            }}
          >
            {f === 'all' ? 'All' : f === 'proof_of_work' ? 'Proof of Work' : f === 'plant_id' ? 'Plant ID' : 'Verified'}
          </button>
        ))}
      </div>

      {filtered.length === 0 && !isLoading && (
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          No submissions yet.{' '}
          <a href="/Dryad/submit" style={{ color: 'var(--green-lit)' }}>Submit proof of work →</a>
        </div>
      )}

      {/* Submission list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
        {filtered.slice(0, 20).map(s => (
          <div key={s.id} style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            padding: '7px 8px',
            background: 'var(--bg-card2)',
            borderRadius: 6,
            border: `1px solid ${s.verified ? 'var(--border)' : '#4a1010'}`,
            fontSize: 12,
          }}>
            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>
              {s.verified ? '✅' : '❌'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {s.workType || s.type.replace('_', ' ')}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>at {s.nearestParcel}</span>
                <Badge label={s.type === 'proof_of_work' ? 'work' : 'plant'} color={s.type === 'proof_of_work' ? 'blue' : 'green'} />
                {!s.processed && <Badge label="pending" color="amber" />}
              </div>
              {s.description && (
                <div style={{ color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.description}
                </div>
              )}
              {s.contractorName && (
                <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>by {s.contractorName}</div>
              )}
              {!s.verified && s.verificationErrors.length > 0 && (
                <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 2 }}>
                  {s.verificationErrors.join(', ')}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right', color: 'var(--text-dim)', fontSize: 10 }}>
              {new Date(s.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}<br />
              {s.distanceMeters.toFixed(0)}m from parcel
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
