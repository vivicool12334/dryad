import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from 'recharts';
import { api } from '../api';
import { Card, Stat, Badge, Loading, Err } from './ui';
import type { DefiData, RebalanceRecord } from '../types';
import {
  CHART_TOOLTIP_STYLE,
  formatChartDateTime,
  formatCurrency,
  formatTimeAgo,
  truncateHash,
} from '../lib/formatting';
import { toBasescanTxUrl } from '../lib/links';

const PROTOCOL_COLORS: Record<string, string> = {
  'Aave V3 USDC': '#B6509E',
  'Compound V3 USDC': '#00D395',
  'idle': 'rgba(210, 214, 193, 0.25)',
};

// ── Allocation donut ───────────────────────────────────────────────────────
function AllocationDonut({ data }: { data: DefiData }) {
  const slices = [
    ...data.positions.map(p => ({
      name: p.protocolName,
      value: p.depositedUsd,
      color: PROTOCOL_COLORS[p.protocolName] || '#7aafd4',
    })),
    ...(data.idleUsdc > 0.01 ? [{ name: 'Idle USDC', value: data.idleUsdc, color: PROTOCOL_COLORS.idle }] : []),
  ];

  if (slices.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 100, height: 100, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={28}
              outerRadius={46}
              strokeWidth={0}
            >
              {slices.map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {slices.map(s => (
          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{s.name}</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              ${formatCurrency(s.value, 2)}
            </span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              {data.totalValue > 0 ? `${((s.value / data.totalValue) * 100).toFixed(0)}%` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Protocol positions table ───────────────────────────────────────────────
function PositionsTable({ data }: { data: DefiData }) {
  if (data.positions.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
        No active DeFi positions - idle USDC awaiting deployment
      </div>
    );
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0', fontSize: 12 }}>
      <thead>
        <tr style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <th style={{ textAlign: 'left', paddingBottom: 6 }}>Protocol</th>
          <th style={{ textAlign: 'right', paddingBottom: 6, paddingLeft: 12 }}>Deposited</th>
          <th style={{ textAlign: 'right', paddingBottom: 6, paddingLeft: 12 }}>APY</th>
          <th style={{ textAlign: 'right', paddingBottom: 6, paddingLeft: 12 }}>Yield/yr</th>
          <th style={{ textAlign: 'right', paddingBottom: 6, paddingLeft: 12 }}>Tx</th>
        </tr>
      </thead>
      <tbody>
        {data.positions.map(pos => {
          const yearlyYield = pos.depositedUsd * pos.currentApy;
          return (
            <tr key={pos.protocolName} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: PROTOCOL_COLORS[pos.protocolName] || '#7aafd4',
                  flexShrink: 0,
                }} />
                {pos.protocolName}
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', paddingLeft: 12, whiteSpace: 'nowrap' }}>
                ${formatCurrency(pos.depositedUsd)}
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--green)', paddingLeft: 12, whiteSpace: 'nowrap' }}>
                {(pos.currentApy * 100).toFixed(2)}%
              </td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', paddingLeft: 12, whiteSpace: 'nowrap' }}>
                ${formatCurrency(yearlyYield)}
              </td>
              <td style={{ textAlign: 'right', paddingLeft: 12, whiteSpace: 'nowrap' }}>
                {pos.depositTxHash ? (
                  <a
                    href={toBasescanTxUrl(pos.depositTxHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--amber)', fontSize: 11, fontFamily: 'var(--font-mono)' }}
                    title={pos.depositTxHash}
                  >
                    {truncateHash(pos.depositTxHash)} ↗
                  </a>
                ) : (
                  <span style={{ color: 'var(--text-dim)' }}>-</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── APY trend sparkline ────────────────────────────────────────────────────
function ApyTrend({ data }: { data: DefiData }) {
  if (!data.yieldHistory || data.yieldHistory.length < 2) return null;

  const chartData = data.yieldHistory.map(s => ({
    date: formatChartDateTime(s.timestamp),
    bestApy: s.bestApy * 100,
    ...Object.fromEntries(s.protocols.map(p => [p.name, p.apy * 100])),
  }));

  const protocolNames = data.protocols.map(p => p.name);

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>APY trend (7 days)</div>
      <ResponsiveContainer width="100%" height={80}>
        <AreaChart data={chartData}>
          <defs>
            {protocolNames.map((name, i) => (
              <linearGradient key={name} id={`apy-g-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={PROTOCOL_COLORS[name] || '#7aafd4'} stopOpacity={0.3} />
                <stop offset="95%" stopColor={PROTOCOL_COLORS[name] || '#7aafd4'} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(value: number | string, name: string) => [`${Number(value).toFixed(2)}%`, name]}
          />
          {protocolNames.map((name, i) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stroke={PROTOCOL_COLORS[name] || '#7aafd4'}
              fill={`url(#apy-g-${i})`}
              strokeWidth={1.5}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Rebalance history timeline ─────────────────────────────────────────────
function RebalanceTimeline({ records }: { records: RebalanceRecord[] }) {
  // Show most recent 5
  const recent = [...records].reverse().slice(0, 5);
  if (recent.length === 0) {
    return (
      <div style={{ color: 'var(--text-dim)', fontSize: 12, fontStyle: 'italic' }}>
        No rebalance history yet
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Recent rebalances
      </div>
      {recent.map((rec, i) => {
        const successCount = rec.actions.filter(a => a.success).length;
        const totalCount = rec.actions.length;
        const totalMoved = rec.actions.filter(a => a.success).reduce((s, a) => s + a.amountUsd, 0);
        const allSuccess = successCount === totalCount;

        return (
          <div key={i} style={{
            borderLeft: `2px solid ${allSuccess ? 'var(--green)' : 'var(--amber)'}`,
            paddingLeft: 12,
            paddingBottom: 4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatTimeAgo(rec.timestamp)}</span>
              <Badge label={allSuccess ? `${successCount}/${totalCount} ok` : `${successCount}/${totalCount}`} color={allSuccess ? 'green' : 'amber'} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 2 }}>{rec.reasoning}</div>
            {rec.actions.filter(a => a.success && a.txHash).map((a, j) => (
              <div key={j} style={{ fontSize: 11, marginTop: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ color: a.action === 'deposit' ? 'var(--green)' : 'var(--amber)' }}>
                  {a.action === 'deposit' ? '↓' : '↑'} ${formatCurrency(a.amountUsd, 0)} → {a.protocol}
                </span>
                {a.txHash && (
                  <a
                    href={toBasescanTxUrl(a.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--amber)', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                  >
                    {truncateHash(a.txHash)} ↗
                  </a>
                )}
              </div>
            ))}
            {rec.estimatedApyBefore !== rec.estimatedApyAfter && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                APY: {(rec.estimatedApyBefore * 100).toFixed(2)}% → {(rec.estimatedApyAfter * 100).toFixed(2)}%
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function DefiAllocationsCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['defi'],
    queryFn: () => api.defi(7),
    refetchInterval: 60_000,
  });

  const blendedApyPct = data ? (data.blendedApy * 100).toFixed(2) : '-';
  const apyColor = data && data.blendedApy > 0.03 ? 'var(--green)' : 'var(--amber)';

  return (
    <Card title="DeFi Allocations" badge={data ? <Badge label="Base L2" color="blue" /> : undefined}>
      {isLoading && <Loading />}
      {error && (error as Error).message !== 'ROUTE_NOT_DEPLOYED' && <Err msg="Could not load DeFi data" />}

      {data && (
        <>
          {/* Top stats */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Stat value={`$${formatCurrency(data.totalValue)}`} label="Total USDC" />
            <Stat value={`$${formatCurrency(data.totalDeposited)}`} label="Deployed" color={data.totalDeposited > 0 ? 'var(--green)' : 'var(--text-dim)'} />
            <Stat value={`${blendedApyPct}%`} label="Blended APY" color={apyColor} />
            <Stat value={`$${formatCurrency(data.annualYieldUsd)}/yr`} label="Projected yield" color={apyColor} />
          </div>

          {/* Allocation donut */}
          <AllocationDonut data={data} />

          {/* Position details */}
          <PositionsTable data={data} />

          {/* APY trend */}
          <ApyTrend data={data} />

          {/* Cash reserve */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-dim)' }}>Idle USDC (cash reserve)</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: data.idleUsdc > 5 ? 'var(--text)' : 'var(--amber)' }}>
              ${formatCurrency(data.idleUsdc)}
            </span>
          </div>

          {/* Rebalance timeline */}
          <RebalanceTimeline records={data.rebalanceHistory} />

          {/* Last rebalance info */}
          {data.rebalancerStatus.lastRebalance > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', marginTop: 4 }}>
              Last rebalance: {formatTimeAgo(data.rebalancerStatus.lastRebalance)} · Next check in ~{Math.max(0, (0.04 - data.rebalancerStatus.daysSinceRebalance)).toFixed(1)}d
            </div>
          )}
        </>
      )}
    </Card>
  );
}
