import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { api } from '../api';
import { Card, Stat, Badge, Loading, Err } from '../App';

const ANNUAL_COST = 945;
const NON_NEGOTIABLE = 383;
const STETH_APR = 0.035;
const SUSTAINABILITY_TARGET = ANNUAL_COST / STETH_APR; // ~$27,000

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function TreasuryCard() {
  const { data: current, isLoading, error } = useQuery({
    queryKey: ['treasury-current'],
    queryFn: api.treasuryCurrent,
    refetchInterval: 60_000,
  });

  const { data: history } = useQuery({
    queryKey: ['treasury-history'],
    queryFn: () => api.treasuryHistory(30),
    refetchInterval: 5 * 60_000,
  });

  // Compute live values from current endpoint (has live ETH price)
  const ethNum = parseFloat(current?.ethBalance ?? '0');
  const wstNum = parseFloat(current?.wstethBalance ?? '0');
  const ethPrice = 2600; // fallback; actual price baked into daily yield
  const annualYield = wstNum * ethPrice * STETH_APR;
  const estimatedUsd = (ethNum + wstNum) * ethPrice;
  const mode = annualYield >= ANNUAL_COST ? 'NORMAL' : annualYield >= NON_NEGOTIABLE ? 'CONSERVATION' : 'CRITICAL';
  const progressPct = Math.min((estimatedUsd / SUSTAINABILITY_TARGET) * 100, 100);

  // Build chart data from snapshots (oldest first for left-to-right)
  const chartData = history
    ? [...history].reverse().map(s => ({
        date: new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        usd: s.estimatedUsd,
        yield: s.annualYieldUsd,
      }))
    : [];

  // Stress test values
  const drop30Yield = wstNum * (ethPrice * 0.7) * STETH_APR;
  const drop50Yield = wstNum * (ethPrice * 0.5) * STETH_APR;

  const modeColor = mode === 'NORMAL' ? 'green' : mode === 'CONSERVATION' ? 'amber' : 'red';
  const modeBadge = <Badge label={mode} color={modeColor} />;

  return (
    <Card title="Treasury" badge={modeBadge}>
      {isLoading && <Loading />}
      {error && (error as Error).message !== 'ROUTE_NOT_DEPLOYED' && <Err msg="Could not load treasury data" />}

      {current && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Stat value={parseFloat(current.wstethBalance).toFixed(4)} label="wstETH" />
            <Stat value={parseFloat(current.ethBalance).toFixed(4)} label="ETH" />
            <Stat value={`~$${fmt(estimatedUsd)}`} label="USD est." color={estimatedUsd >= SUSTAINABILITY_TARGET ? 'var(--green)' : 'var(--amber)'} />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Stat value={`$${fmt(annualYield, 0)}/yr`} label="Yield/yr (3.5% APR)" color={annualYield >= ANNUAL_COST ? 'var(--green)' : 'var(--red)'} />
            <Stat value={current.dailyYieldUSD} label="Daily yield" />
          </div>

          {/* Progress to sustainability */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
              <span>Progress to $27K sustainability target</span>
              <span>{progressPct.toFixed(0)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                minWidth: progressPct > 0 ? 6 : 0,
                background: progressPct >= 100 ? 'var(--green)' : progressPct >= 60 ? 'var(--amber)' : 'var(--red)',
                borderRadius: 3,
                transition: 'width 0.4s ease',
              }} />
            </div>
          </div>
        </>
      )}

      {/* Treasury value trend chart */}
      {chartData.length > 1 && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Treasury value (30 days)</div>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#66bb6a" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#66bb6a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                formatter={(v: any) => [`$${fmt(v)}`, 'Value']}
              />
              <ReferenceLine y={SUSTAINABILITY_TARGET} stroke="#4caf50" strokeDasharray="3 3" strokeOpacity={0.5} />
              <Area type="monotone" dataKey="usd" stroke="#66bb6a" fill="url(#tg)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stress test */}
      <details className="stress-test">
        <summary>
          ▸ Stress test
        </summary>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
          <thead>
            <tr style={{ color: 'var(--text-dim)' }}>
              <th style={{ textAlign: 'left', paddingBottom: 4 }}>Scenario</th>
              <th style={{ textAlign: 'right' }}>Yield/yr</th>
              <th style={{ textAlign: 'right' }}>vs $945</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: 'Current', yield: annualYield },
              { label: 'ETH −30%', yield: drop30Yield },
              { label: 'ETH −50%', yield: drop50Yield },
            ].map(row => (
              <tr key={row.label} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 0' }}>{row.label}</td>
                <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>${fmt(row.yield, 0)}</td>
                <td style={{ textAlign: 'right', color: row.yield >= ANNUAL_COST ? 'var(--green)' : 'var(--red)' }}>
                  {row.yield >= ANNUAL_COST ? '✓ covered' : `−$${fmt(ANNUAL_COST - row.yield, 0)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}
