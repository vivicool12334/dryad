import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api } from '../api';
import { Card, Stat, Badge, Loading, Err } from '../App';

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ${m}m ago`;
  return `${m}m ago`;
}

function timeUntil(ts: number) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STEP_ICONS: Record<string, string> = {
  submissions: '📬',
  biodiversity: '🌿',
  treasury: '💰',
  diem: '🔷',
  weekly_report: '📋',
};

export default function AgentHealthCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['loop-latest'],
    queryFn: api.loopLatest,
    refetchInterval: 30_000,
  });

  const { data: history } = useQuery({
    queryKey: ['loop-history'],
    queryFn: () => api.loopHistory(30),
    refetchInterval: 60_000,
  });

  const latest = data?.latest;
  const stats = data?.stats;
  const nextRunAt = data?.nextRunAt;

  // Build sparkline data from history (oldest first)
  const sparkData = history
    ? [...history].reverse().map(e => ({
        t: new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        success: e.status === 'success' ? 1 : 0,
        duration: Math.round(e.durationMs / 1000),
      }))
    : [];

  return (
    <Card title="Agent Health">
      {isLoading && <Loading />}
      {error && <Err msg="Could not load loop history" />}

      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Stat value={stats.totalRuns} label="Runs (30d)" />
          <Stat
            value={`${stats.successRuns}/${stats.totalRuns}`}
            label="Success rate"
            color={stats.failureRuns === 0 ? 'var(--green)' : 'var(--amber)'}
          />
          <Stat value={formatDuration(stats.avgDurationMs)} label="Avg duration" />
        </div>
      )}

      {/* Run history sparkline */}
      {sparkData.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Loop duration (seconds, 30 days)</div>
          <ResponsiveContainer width="100%" height={60}>
            <AreaChart data={sparkData}>
              <defs>
                <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4caf50" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4caf50" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                formatter={(v: any) => [`${v}s`, 'duration']}
              />
              <Area type="monotone" dataKey="duration" stroke="#4caf50" fill="url(#dg)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Last / next run */}
      <div style={{ display: 'flex', gap: 20, fontSize: 13, flexWrap: 'wrap' }}>
        <div>
          <span style={{ color: 'var(--text-dim)' }}>Last run: </span>
          {latest ? (
            <>
              <span style={{ color: latest.status === 'success' ? 'var(--green)' : 'var(--red)' }}>
                {latest.status === 'success' ? '✓' : '✗'}
              </span>
              {' '}{timeAgo(latest.timestamp)}
              {' '}<span style={{ color: 'var(--text-dim)', fontSize: 11 }}>({formatDuration(latest.durationMs)})</span>
            </>
          ) : <span style={{ color: 'var(--text-dim)' }}>No runs yet</span>}
        </div>
        {nextRunAt && (
          <div>
            <span style={{ color: 'var(--text-dim)' }}>Next run: </span>
            <span style={{ color: 'var(--green-lit)' }}>~{timeUntil(nextRunAt)}</span>
          </div>
        )}
      </div>

      {/* Last cycle steps */}
      {latest?.steps && latest.steps.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Last cycle steps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {latest.steps.map(step => (
              <div key={step.name} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                padding: '4px 8px',
                background: 'var(--bg-card2)',
                borderRadius: 5,
                border: `1px solid ${step.status === 'error' ? 'var(--red)' : 'var(--border)'}`,
              }}>
                <span>{STEP_ICONS[step.name] || '·'}</span>
                <span style={{ color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>{step.name}</span>
                <span style={{ color: step.status === 'error' ? 'var(--red)' : step.status === 'skipped' ? 'var(--text-dim)' : 'var(--text)', flex: 1 }}>
                  {step.result}
                </span>
                <span style={{ color: 'var(--text-dim)', fontSize: 10, whiteSpace: 'nowrap' }}>{formatDuration(step.durationMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions triggered */}
      {latest?.actionsTriggered && latest.actionsTriggered.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {latest.actionsTriggered.map(a => (
            <Badge key={a} label={a} color="blue" />
          ))}
        </div>
      )}

      {/* Season */}
      {latest?.season && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Season: <span style={{ color: 'var(--text-muted)' }}>{latest.season}</span>
        </div>
      )}
    </Card>
  );
}
