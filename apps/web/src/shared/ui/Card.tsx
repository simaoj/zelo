import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={cx('relative overflow-hidden rounded-card bg-surface p-4 shadow-card sm:p-5', className)} {...rest}>
      {children}
    </section>
  );
}

/** Section heading with the colored pill accent used in the mockups. */
export function SectionTitle({
  children,
  accent = 'orange',
  action,
  id,
  as: As = 'h2',
}: {
  children: ReactNode;
  accent?: 'orange' | 'teal' | 'yellow' | 'pink';
  action?: ReactNode;
  id?: string;
  as?: 'h2' | 'h3';
}) {
  const color = {
    orange: 'bg-brand-orange',
    teal: 'bg-brand-teal',
    yellow: 'bg-brand-yellow',
    pink: 'bg-brand-pink',
  }[accent];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={cx('h-6 w-2.5 shrink-0 rounded-full', color)} />
        <As id={id} className="font-display text-xl font-semibold text-ink">
          {children}
        </As>
      </div>
      {action}
    </div>
  );
}

/** Small uppercase eyebrow label. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('text-[11px] font-bold uppercase tracking-[0.08em] text-brand-orange-ink', className)}>{children}</p>
  );
}

export function PageHeader({ eyebrow, title, description, aside }: { eyebrow?: string; title: string; description?: ReactNode; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink lg:text-[34px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {aside}
    </header>
  );
}
