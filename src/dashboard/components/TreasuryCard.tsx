import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { Card, Stat, Badge, Loading } from "./ui";
import { CHART_TOOLTIP_STYLE, formatCurrency, formatShortDate } from "../lib/formatting";
import { toBasescanAddressUrl } from "../lib/links";
import {
  ANNUAL_OPERATING_COST_USD,
  NON_NEGOTIABLE_ANNUAL_COST_USD,
  SPENDING_MODE_META,
  getSpendingMode,
} from "../../shared/treasuryMode";

export default function TreasuryCard() {
  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ["treasury-current"],
    queryFn: api.treasuryCurrent,
    refetchInterval: 60_000,
  });

  const { data: defi, isLoading: loadingDefi } = useQuery({
    queryKey: ["defi-treasury"],
    queryFn: () => api.defi(7),
    refetchInterval: 60_000,
  });

  const { data: history } = useQuery({
    queryKey: ["treasury-history"],
    queryFn: () => api.treasuryHistory(30),
    refetchInterval: 5 * 60_000,
  });

  const isLoading = loadingCurrent && loadingDefi;
  const treasuryCurrent = current && "error" in current ? null : current;

  // USDC-based values from DeFi endpoint
  const totalUsdc = defi?.totalValue ?? 0;
  const deployedUsdc = defi?.totalDeposited ?? 0;
  const idleUsdc = defi?.idleUsdc ?? 0;
  const blendedApy = defi?.blendedApy ?? 0;
  const annualYield = defi?.annualYieldUsd ?? 0;
  const dailyYield = defi?.dailyYieldUsd ?? 0;

  // ETH balance (for gas)
  const ethBal = parseFloat(treasuryCurrent?.ethBalance ?? "0");

  // Spending mode from yield
  const mode =
    getSpendingMode(
      annualYield,
      ANNUAL_OPERATING_COST_USD,
      NON_NEGOTIABLE_ANNUAL_COST_USD,
    );

  // Sustainability: how much USDC deployed at current APY to cover $945/yr
  const sustainabilityTarget =
    blendedApy > 0 ? ANNUAL_OPERATING_COST_USD / blendedApy : 27000;
  const progressPct = Math.min(
    (deployedUsdc / sustainabilityTarget) * 100,
    100,
  );

  // Build chart from snapshots
  const chartData = history
    ? [...history].reverse().map((s) => ({
        date: formatShortDate(s.timestamp),
        usd: s.estimatedUsd,
      }))
    : [];

  const modeColor = SPENDING_MODE_META[mode].badgeColor;

  return (
    <Card title="Treasury" badge={<Badge label={mode} color={modeColor} />}>
      {isLoading && <Loading />}

      {(treasuryCurrent || defi) && (
        <>
          {/* Primary: USDC balances */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Stat value={`$${formatCurrency(totalUsdc, 2)}`} label="Total USDC" />
            <Stat
              value={`$${formatCurrency(deployedUsdc, 2)}`}
              label="Earning yield"
              color={deployedUsdc > 0 ? "var(--green)" : "var(--text-dim)"}
            />
            <Stat value={`$${formatCurrency(idleUsdc, 2)}`} label="Idle (reserve)" />
          </div>

          {/* Yield metrics */}
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <Stat
              value={`${(blendedApy * 100).toFixed(2)}%`}
              label="Blended APY"
              color={blendedApy > 0.03 ? "var(--green)" : "var(--amber)"}
            />
            <Stat
              value={`$${formatCurrency(annualYield, 2)}/yr`}
              label="Projected yield"
              color={annualYield >= ANNUAL_OPERATING_COST_USD ? "var(--green)" : "var(--red)"}
            />
            <Stat value={`$${dailyYield.toFixed(4)}/d`} label="Daily yield" />
          </div>

          {/* Gas balance */}
          {ethBal > 0 && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "var(--text-dim)",
              }}
            >
              <span>Gas (ETH on Base)</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {ethBal.toFixed(6)} ETH
              </span>
            </div>
          )}

          {/* Progress to sustainability */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-dim)",
                marginBottom: 4,
              }}
            >
              <span>
                Progress to sustainability
                <span style={{ fontSize: 10, marginLeft: 4 }}>
                  (${formatCurrency(sustainabilityTarget, 0)} USDC @{" "}
                  {(blendedApy * 100).toFixed(1)}% to cover ${ANNUAL_OPERATING_COST_USD}
                  /yr)
                </span>
              </span>
              <span>{progressPct.toFixed(0)}%</span>
            </div>
            <div
              style={{
                height: 6,
                background: "var(--border)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  minWidth: progressPct > 0 ? 6 : 0,
                  background:
                    progressPct >= 100
                      ? "var(--green)"
                      : progressPct >= 60
                        ? "var(--amber)"
                        : "var(--red)",
                  borderRadius: 3,
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>
        </>
      )}

      {/* Treasury value trend chart */}
      {chartData.length > 1 && (
        <div>
          <div
            style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 4 }}
          >
            Treasury value (30 days)
          </div>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#66bb6a" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#66bb6a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: number | string) => [`$${formatCurrency(Number(value), 0)}`, "Value"]}
              />
              <Area
                type="monotone"
                dataKey="usd"
                stroke="#66bb6a"
                fill="url(#tg)"
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cost breakdown */}
      <details className="stress-test">
        <summary>▸ Annual cost breakdown</summary>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            marginTop: 8,
          }}
        >
          <thead>
            <tr style={{ color: "var(--text-dim)" }}>
              <th style={{ textAlign: "left", paddingBottom: 4 }}>Expense</th>
              <th style={{ textAlign: "right" }}>Cost/yr</th>
              <th style={{ textAlign: "right" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {[
              { label: "Property taxes", cost: 134 },
              { label: "VPS hosting", cost: 65 },
              { label: "Gas fees", cost: 24 },
              { label: "LLC annual", cost: 25 },
              { label: "Domain + services", cost: 135 },
              { label: "Contractor payments", cost: 562 },
            ].map((row) => (
              <tr
                key={row.label}
                style={{ borderTop: "1px solid var(--border)" }}
              >
                <td style={{ padding: "5px 0" }}>{row.label}</td>
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-muted)",
                  }}
                >
                  ${formatCurrency(row.cost, 0)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    color:
                      annualYield >= row.cost ? "var(--green)" : "var(--red)",
                    fontSize: 11,
                  }}
                >
                  {annualYield >= row.cost ? "✓" : "-"}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--border)" }}>
              <td style={{ padding: "5px 0", fontWeight: 600 }}>Total</td>
              <td
                style={{
                  textAlign: "right",
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                }}
              >
                ${ANNUAL_OPERATING_COST_USD}
              </td>
              <td
                style={{
                  textAlign: "right",
                  color:
                    annualYield >= ANNUAL_OPERATING_COST_USD ? "var(--green)" : "var(--red)",
                }}
              >
                {annualYield >= ANNUAL_OPERATING_COST_USD
                  ? "✓ covered"
                  : `−$${formatCurrency(ANNUAL_OPERATING_COST_USD - annualYield, 0)}`}
              </td>
            </tr>
          </tbody>
        </table>
      </details>

      {/* Wallet address */}
      {treasuryCurrent?.wallet && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            marginTop: 4,
          }}
        >
          <a
            href={toBasescanAddressUrl(treasuryCurrent.wallet)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-dim)" }}
          >
            {treasuryCurrent.wallet} ↗
          </a>
        </div>
      )}
    </Card>
  );
}
