'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, UserRound } from 'lucide-react';
import { SyncStatusBadge } from '@/pwa';
import { useSession } from '@/shared/data/session';
import { useSyncStatus } from '@/shared/data/hooks';
import { Logo } from '@/shared/ui/Logo';
import { cx } from '@/shared/ui/cx';
import { SETTINGS_ITEM, hiddenSectionFor, sectionTitle, visibleNav, type NavItem } from './nav';
import { useRegister } from './RegisterDialog';

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { profile } = useSession();
  const nav = visibleNav(profile.visibleModules);
  const { open } = useRegister();
  const title = sectionTitle(pathname);
  const half = Math.ceil(nav.length / 2);
  const hidden = hiddenSectionFor(pathname, profile.visibleModules);

  return (
    <div className="min-h-dvh">
      <a href="#conteudo" className="sr-only z-[200] rounded bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Pular para o conteúdo
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-6 border-r border-line bg-surface px-5 py-6 lg:flex">
        <Link href="/hoje" className="self-start rounded-md">
          <Logo height={40} priority />
          <span className="sr-only">Zelo — início</span>
        </Link>
        <p className="-mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-brand-orange-ink">Seu cuidado, dia a dia</p>
        <button
          type="button"
          onClick={() => open()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-[16px] bg-brand-orange px-4 font-semibold text-ink shadow-[0_6px_18px_rgba(255,130,67,0.3)] hover:bg-brand-orange-strong"
        >
          <Plus aria-hidden className="size-5" />
          Registrar
        </button>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {[...nav, SETTINGS_ITEM].map((item) => (
            <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </nav>
        <div className="mt-auto">
          <SyncStatusBadge />
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-40 border-b border-line/60 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <div className="flex h-16 items-center justify-between gap-2 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/hoje" className="shrink-0 rounded-md">
              <Logo height={30} priority />
              <span className="sr-only">Zelo — início</span>
            </Link>
            <div className="flex min-w-0 flex-col leading-none">
              <span className="text-[11px] font-semibold text-ink-muted">Zelo</span>
              <span className="truncate text-lg font-semibold text-ink">{title}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <SyncStatusBadge />
            <Link
              href="/configuracoes"
              aria-current={isActive(pathname, '/configuracoes') ? 'page' : undefined}
              className="inline-flex size-11 items-center justify-center rounded-full bg-brand-orange-ink text-white"
            >
              <UserRound aria-hidden className="size-5" />
              <span className="sr-only">Configurações</span>
            </Link>
          </div>
        </div>
      </header>

      <ReauthBanner />

      <div className="lg:pl-64">
        <main
          id="conteudo"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1160px] px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 focus:outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-8"
        >
          {hidden ? (
            <section className="rounded-[var(--radius-card)] border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
              <h1 className="font-display text-2xl font-semibold">{hidden.title} está oculto</h1>
              <p className="mt-2 text-ink-muted">
                Você escolheu não exibir esta seção. Seus registros continuam guardados e você pode mostrá-la de novo quando quiser.
              </p>
              <Link
                href="/configuracoes"
                className="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand-orange px-5 font-semibold text-ink hover:bg-brand-orange-strong"
              >
                Abrir configurações
              </Link>
            </section>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex h-[68px] max-w-lg items-stretch justify-around px-1">
          {nav.slice(0, half).map((item) => (
            <BottomLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <li className="flex flex-1 justify-center">
            <button
              type="button"
              onClick={() => open()}
              className="-mt-5 flex flex-col items-center gap-0.5 text-[11px] font-semibold text-ink"
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-brand-orange shadow-[0_8px_20px_rgba(255,130,67,0.4)] ring-4 ring-background">
                <Plus aria-hidden className="size-7 text-ink" />
              </span>
              Registrar
            </button>
          </li>
          {nav.slice(half).map((item) => (
            <BottomLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </ul>
      </nav>
    </div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] font-semibold transition-colors',
        active ? 'bg-wash-peach text-brand-orange-ink' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
      )}
    >
      <Icon aria-hidden className="size-5" />
      {item.label}
    </Link>
  );
}

function BottomLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <li className="flex flex-1">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
          active ? 'text-brand-orange-ink' : 'text-ink-muted',
        )}
      >
        <Icon aria-hidden className="size-[22px]" />
        {item.label}
      </Link>
    </li>
  );
}

function ReauthBanner() {
  const status = useSyncStatus();
  if (!status.needsReauth) return null;
  return (
    <div role="alert" className="mx-4 mt-3 rounded-field bg-wash-sun px-4 py-3 text-sm text-ink lg:ml-[calc(16rem+2rem)] lg:mr-8 lg:mt-6">
      Sua sessão expirou e a sincronização foi pausada.{' '}
      <Link href="/entrar?sessao=expirada" className="font-semibold underline">
        Entrar novamente
      </Link>
    </div>
  );
}
