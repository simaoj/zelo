import type { ReactNode } from 'react';
import { Logo } from '@/shared/ui/Logo';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden px-4 pb-10 pt-[calc(2.5rem+env(safe-area-inset-top))]">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-brand-yellow/40 blur-2xl" />
      <div aria-hidden className="pointer-events-none absolute -left-20 top-40 size-56 rounded-full bg-brand-pink/40 blur-2xl" />
      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-2">
        <Logo height={56} priority />
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-brand-orange-ink">Seu cuidado, dia a dia</p>
      </div>
      <main className="relative z-10 mt-8 w-full max-w-md rounded-card bg-surface p-5 shadow-float sm:p-7">{children}</main>
    </div>
  );
}
