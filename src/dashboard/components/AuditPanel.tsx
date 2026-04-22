import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, Badge, Loading, Err } from "./ui";
import { formatTime } from "../lib/formatting";

const SEVERITY_COLOR: Record<string, string> = {
  info: "var(--text-dim)",
  warn: "var(--amber)",
  critical: "var(--red)",
};

const TYPE_ABBR: Record<string, string> = {
  TRANSACTION_SUCCESS: "TX ✓",
  TRANSACTION_FAILED: "TX ✗",
  TRANSACTION_BLOCKED: "TX 🚫",
  INJECTION_ATTEMPT: "💉",
  ADDRESS_ALLOWLISTED: "✅ addr",
  ADDRESS_BLOCKED: "🚫 addr",
  CONTRACTOR_ONBOARDED: "👷",
  LOOP_EXECUTION: "🔄",
  LOOP_FAILURE: "🔄 ✗",
  MILESTONE_RECORDED: "⛓",
  TREASURY_MODE_CHANGE: "💰",
  SUBMISSION_RECEIVED: "📬",
  SUBMISSION_REJECTED: "📬 ✗",
  EMAIL_SENT: "📧",
  PAYMENTS_PAUSED: "⏸",
  PAYMENTS_RESUMED: "▶",
  UNKNOWN_ADDRESS_DETECTED: "❓",
};

export default function AuditPanel() {
  const [filterSeverity, setFilterSeverity] = useState<
    "all" | "warn" | "critical"
  >("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () => api.adminAudit(200),
    refetchInterval: 15_000,
  });

  const entries = data?.entries ?? [];
  const summary = data?.summary;

  const filtered = entries.filter((e) => {
    if (filterSeverity === "warn")
      return e.severity === "warn" || e.severity === "critical";
    if (filterSeverity === "critical") return e.severity === "critical";
    return true;
  });

  return (
    <Card title="Security & Audit Log (Admin)">
      {isLoading && <Loading />}
      {error?.message === "UNAUTHORIZED" && (
        <div style={{ color: "var(--amber)", fontSize: 13 }}>
          🔒 Sign in as admin to view audit log
        </div>
      )}
      {error && error.message !== "UNAUTHORIZED" && (
        <Err msg="Could not load audit log" />
      )}

      {data && (
        <>
          {/* Summary row */}
          {summary && (
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                fontSize: 12,
              }}
            >
              <span>
                <strong style={{ color: "var(--text)" }}>
                  {summary.totalEvents}
                </strong>
                <span style={{ color: "var(--text-dim)" }}> events (24h)</span>
              </span>
              {(summary.bySeverity?.warn ?? 0) > 0 && (
                <span>
                  <strong style={{ color: "var(--amber)" }}>
                    {summary.bySeverity.warn ?? 0}
                  </strong>
                  <span style={{ color: "var(--text-dim)" }}> warnings</span>
                </span>
              )}
              {(summary.bySeverity?.critical ?? 0) > 0 && (
                <span>
                  <strong style={{ color: "var(--red)" }}>
                    {summary.bySeverity.critical ?? 0}
                  </strong>
                  <span style={{ color: "var(--text-dim)" }}> critical</span>
                </span>
              )}
              {(summary.byType?.INJECTION_ATTEMPT ?? 0) > 0 && (
                <span>
                  <strong style={{ color: "var(--red)" }}>
                    {summary.byType.INJECTION_ATTEMPT ?? 0}
                  </strong>
                  <span style={{ color: "var(--text-dim)" }}>
                    {" "}
                    injection attempts
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "warn", "critical"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilterSeverity(f)}
                style={{
                  background:
                    filterSeverity === f
                      ? f === "critical"
                        ? "#4a1010"
                        : f === "warn"
                          ? "#4a3800"
                          : "var(--border-lit)"
                      : "var(--bg-card2)",
                  color:
                    filterSeverity === f
                      ? f === "critical"
                        ? "var(--red)"
                        : f === "warn"
                          ? "var(--amber)"
                          : "#fff"
                      : "var(--text-dim)",
                  border: `1px solid ${filterSeverity === f ? "currentColor" : "var(--border)"}`,
                  borderRadius: 5,
                  padding: "3px 10px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>

          {/* Log entries */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              maxHeight: 350,
              overflowY: "auto",
              fontFamily: "var(--font-mono)",
            }}
          >
            {filtered.slice(0, 100).map((entry, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  padding: "4px 6px",
                  borderRadius: 4,
                  background:
                    entry.severity === "critical"
                      ? "rgba(239,83,80,0.07)"
                      : entry.severity === "warn"
                        ? "rgba(249,168,37,0.05)"
                        : "transparent",
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    color: "var(--text-dim)",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    fontSize: 10,
                  }}
                >
                  {formatTime(entry.timestamp)}
                </span>
                <span
                  style={{
                    color: SEVERITY_COLOR[entry.severity] ?? "var(--text-dim)",
                    flexShrink: 0,
                    width: 20,
                    textAlign: "center",
                  }}
                >
                  {entry.severity === "critical"
                    ? "🔴"
                    : entry.severity === "warn"
                      ? "🟡"
                      : "·"}
                </span>
                <span
                  style={{
                    color: "var(--text-muted)",
                    flexShrink: 0,
                    width: 70,
                    overflow: "hidden",
                    fontSize: 10,
                  }}
                >
                  {TYPE_ABBR[entry.type] ??
                    entry.type.replace(/_/g, " ").toLowerCase()}
                </span>
                <span
                  style={{
                    color: SEVERITY_COLOR[entry.severity] ?? "var(--text)",
                    flex: 1,
                    wordBreak: "break-word",
                  }}
                >
                  {entry.details}
                </span>
                <span
                  style={{
                    color: "var(--text-dim)",
                    flexShrink: 0,
                    fontSize: 10,
                  }}
                >
                  {entry.source}
                </span>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ color: "var(--text-dim)", padding: "8px 6px" }}>
                No events matching filter.
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
