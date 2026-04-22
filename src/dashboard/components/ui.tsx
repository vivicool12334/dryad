import type { ReactNode } from 'react';

type CardProps = {
  title?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ title, badge, children, className = '' }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
      className={className}
    >
      {title && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 10,
            marginBottom: 2,
          }}
        >
          <h2
            style={{
              color: 'var(--amber)',
              fontSize: 18,
              fontWeight: 400,
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
            }}
          >
            {title}
          </h2>
          {badge && <div style={{ flexShrink: 0 }}>{badge}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({
  value,
  label,
  color,
  size,
}: {
  value: ReactNode;
  label: string;
  color?: string;
  size?: 'sm' | 'md';
}) {
  const fontSize = size === 'sm' ? 18 : 22;
  return (
    <div style={{ flex: '0 0 auto', minWidth: 0 }}>
      <div
        style={{
          fontSize,
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: color || 'var(--amber)',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          marginTop: 4,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const colors: Record<string, { border: string; text: string }> = {
    green: { border: 'rgba(141,166,103,0.5)', text: '#a0bb78' },
    amber: { border: 'rgba(226,158,75,0.5)', text: '#e29e4b' },
    red: { border: 'rgba(192,57,43,0.5)', text: '#e74c3c' },
    blue: { border: 'rgba(91,141,184,0.5)', text: '#7aafd4' },
    gray: { border: 'rgba(210,214,193,0.2)', text: 'rgba(210,214,193,0.5)' },
  };
  const palette = colors[color || 'green'];
  return (
    <span
      style={{
        border: `1px solid ${palette.border}`,
        color: palette.text,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

export function Loading() {
  return (
    <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      loading…
    </span>
  );
}

export function Err({ msg }: { msg: string }) {
  return <span style={{ color: 'var(--red-lit)', fontSize: 12 }}>⚠ {msg}</span>;
}
