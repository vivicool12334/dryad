import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { api } from '../api';
import { Card, Badge, Loading, Err } from '../App';

function shortAddr(addr: string) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function TransactionTable() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-transactions'],
    queryFn: api.adminTransactions,
    refetchInterval: 30_000,
  });

  const history = data?.history ?? [];
  const dailySpend = data?.dailySpendUsd ?? 0;
  const dailyLimit = data?.dailyLimitUsd ?? 200;
  const perTxLimit = data?.perTxLimitUsd ?? 50;
  const paused = data?.paymentsPaused ?? false;

  // Build 30-day bar chart (spend per day)
  const spendByDay: Record<string, number> = {};
  history.forEach(tx => {
    const key = new Date(tx.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    spendByDay[key] = (spendByDay[key] || 0) + tx.amount;
  });
  const chartData = Object.entries(spendByDay).map(([date, amount]) => ({ date, amount })).slice(-14);

  const pct = Math.min((dailySpend / dailyLimit) * 100, 100);

  return (
    <Card title="Transaction History (Admin)">
      {isLoading && <Loading />}
      {error?.message === 'UNAUTHORIZED' && (
        <div style={{ color: 'var(--amber)', fontSize: 13 }}>🔒 Sign in as admin to view transaction details</div>
      )}
      {error && error.message !== 'UNAUTHORIZED' && <Err msg="Could not load transactions" />}

      {data && (
        <>
          {/* Status row */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Today: </span>
              <span style={{ fontWeight: 700, color: pct > 80 ? 'var(--red)' : 'var(--green-lit)' }}>${dailySpend.toFixed(2)}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}> / ${dailyLimit}</span>
            </div>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', minWidth: 100 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? 'var(--red)' : 'var(--green)', borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Per-tx limit: <strong>${perTxLimit}</strong>
            </div>
            {paused ? (
              <Badge label="PAYMENTS PAUSED" color="red" />
            ) : (
              <Badge label="Payments active" color="green" />
            )}
          </div>

          {/* Spend bar chart */}
          {chartData.length > 1 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>Daily spend (14 days)</div>
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={chartData}>
                  <XAxis dataKey="date" hide />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: 11 }}
                    formatter={(v: any) => [`$${v.toFixed(2)}`, 'Spent']}
                  />
                  <Bar dataKey="amount" fill="#4caf50" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Transaction table */}
          {history.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No transactions recorded yet.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', paddingBottom: 6, paddingRight: 12 }}>Date</th>
                    <th style={{ textAlign: 'left', paddingBottom: 6, paddingRight: 12 }}>Recipient</th>
                    <th style={{ textAlign: 'right', paddingBottom: 6, paddingRight: 12 }}>Amount</th>
                    <th style={{ textAlign: 'left', paddingBottom: 6 }}>Tx Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().slice(0, 30).map((tx, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {relDate(tx.timestamp)}
                      </td>
                      <td style={{ padding: '6px 12px 6px 0', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                        <a href={`https://basescan.org/address/${tx.recipient}`} target="_blank" rel="noopener">
                          {shortAddr(tx.recipient)}
                        </a>
                      </td>
                      <td style={{ padding: '6px 12px 6px 0', textAlign: 'right', color: 'var(--green-lit)', fontWeight: 600 }}>
                        ${tx.amount.toFixed(2)} USDC
                      </td>
                      <td style={{ padding: '6px 0', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                        {tx.txHash ? (
                          <a href={`https://basescan.org/tx/${tx.txHash}`} target="_blank" rel="noopener" style={{ color: 'var(--text-dim)' }}>
                            {shortAddr(tx.txHash)}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
