'use client';
import type { ReactNode } from 'react';
import { RouteTabs } from '@/shared/ui/RouteTabs';
import { ATIVIDADE_TABS } from '@/features/shell/nav';

/** Atividade section: tabs Resumo | Passos | Exercícios (read-only data received from Auto Export). */
export function AtividadeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <RouteTabs
        label="Seções de atividade"
        tabs={ATIVIDADE_TABS.map((t) => {
          const Icon = t.icon;
          return { href: t.href, label: t.label, icon: <Icon aria-hidden className="size-[18px] max-[359px]:hidden" /> };
        })}
      />
      {children}
    </div>
  );
}
