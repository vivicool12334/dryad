import type { CSSProperties } from 'react';

const LOCALE = 'en-US';

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  fontSize: 11,
};

export function formatCurrency(value: number, decimals = 2): string {
  return value.toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatShortDate(value: number | string | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
}

export function formatLongDate(value: number | string | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatChartDateTime(value: number | string | Date): string {
  return new Date(value).toLocaleDateString(LOCALE, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
  });
}

export function formatTime(value: number | string | Date): string {
  return new Date(value).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatTimeAgo(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m ago` : `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

export function truncateHash(hash: string): string {
  if (!hash) return '-';
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
