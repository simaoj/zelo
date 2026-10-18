'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/shared/data/session';
import { RouteTabs } from '@/shared/ui/RouteTabs';
import { LoadingState } from '@/shared/ui/States';
import { SAUDE_TABS, visibleSaudeTabs } from '@/features/shell/nav';

const LAST_TAB_KEY = 'zelo:saude:aba';

function readLastTab(): string | null {
  try {
    return window.localStorage.getItem(LAST_TAB_KEY);
  } catch {
    return null;
  }
}

/** Saúde section: tabs Pressão | Água (each a route). Remembers the last tab on this device. */
export function SaudeLayout({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const pathname = usePathname();
  const tabs = visibleSaudeTabs(profile.visibleModules);

  useEffect(() => {
    const tab = SAUDE_TABS.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
    if (!tab) return;
    try {
      window.localStorage.setItem(LAST_TAB_KEY, tab.href);
    } catch {
      /* storage unavailable: no memory of the last tab */
    }
  }, [pathname]);

  return (
    <div className="flex flex-col gap-5">
      {tabs.length > 1 && (
        <RouteTabs
          label="Seções de saúde"
          tabs={tabs.map((t) => {
            const Icon = t.icon;
            return { href: t.href, label: t.label, icon: <Icon aria-hidden className="size-[18px]" /> };
          })}
        />
      )}
      {children}
    </div>
  );
}

/** /saude → last used tab (or the first visible one). */
export function SaudeIndex() {
  const router = useRouter();
  const { profile } = useSession();
  useEffect(() => {
    const tabs = visibleSaudeTabs(profile.visibleModules);
    const last = readLastTab();
    const target = tabs.find((t) => t.href === last)?.href ?? tabs[0]?.href ?? '/saude/pressao';
    router.replace(target);
  }, [router, profile.visibleModules]);
  return <LoadingState />;
}
