'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from './cx';

export interface RouteTab {
  href: string;
  label: string;
  icon?: ReactNode;
}

/** Segmented tabs where each tab is its own route (links with aria-current). */
export function RouteTabs({ tabs, label }: { tabs: RouteTab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 rounded-[18px] bg-surface-muted p-1">
        {tabs.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <li key={t.href} className="flex min-w-0 flex-1">
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] px-2 text-sm font-semibold transition-colors',
                  active ? 'bg-surface text-brand-orange-ink shadow-card' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t.icon}
                <span className="truncate">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
