import type { ReactNode } from 'react';

/**
 * Decorative circular progress (the value is always also given as text). The arc is full
 * at ≥100%, but callers show the real number — values above the goal are never hidden.
 */
export function ProgressRing({ fraction, size = 200, stroke = 16, color = '#006a6a', children }: { fraction: number | null; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = fraction == null ? 0 : Math.max(0, Math.min(1, fraction));
  return (
    <div className="relative mx-auto flex items-center justify-center" style={{ width: size, height: size, maxWidth: '100%' }}>
      <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 size-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ebe6df" strokeWidth={stroke} />
        {f > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} />}
      </svg>
      <div className="relative flex flex-col items-center text-center">{children}</div>
    </div>
  );
}

/** Thin linear progress (decorative; pair with text). */
export function ProgressBar({ fraction, color = 'bg-brand-teal-ink' }: { fraction: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div aria-hidden className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
