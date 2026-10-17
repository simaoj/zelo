'use client';
import { useRef, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

/** Segmented tabs (WAI-ARIA tabs pattern with arrow-key navigation). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % items.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(items[next]!.value);
      refs.current[next]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-[18px] bg-surface-muted p-1">
      {items.map((t, i) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${t.value}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[14px] px-3 text-sm font-semibold transition-colors',
              selected ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${value}`} aria-labelledby={`${idPrefix}-tab-${value}`} tabIndex={-1} className="focus:outline-none">
      {children}
    </div>
  );
}

/** Pill chips acting as a single-choice group (period filters, type selectors). */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = 'teal',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  tone?: 'teal' | 'orange';
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-11 rounded-full px-4 text-[13px] font-semibold transition-colors',
              active
                ? tone === 'teal'
                  ? 'bg-brand-teal-ink text-white'
                  : 'bg-brand-orange text-ink'
                : 'bg-surface-muted text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
