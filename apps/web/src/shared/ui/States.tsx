'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { LoaderCircle, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { describeError } from '@/shared/data/errors';
import { Button } from './Button';
import { cx } from './cx';

export function LoadingState({ label = 'Carregando…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cx('flex items-center gap-2 py-6 text-sm text-ink-muted', className)}>
      <LoaderCircle aria-hidden className="size-5 animate-spin text-brand-teal" />
      {label}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="rounded-card bg-surface p-5 shadow-card">
      <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="mt-3 h-3 w-full animate-pulse rounded bg-surface-muted" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line bg-surface/60 p-5">
      {icon && <div className="flex size-11 items-center justify-center rounded-[14px] bg-wash-sun text-[#6c5e00]">{icon}</div>}
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="text-sm text-ink-muted">{children}</p>}
      {action}
    </div>
  );
}

/** Distinct visual states for load errors: offline, session expired, conflict, generic. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const d = describeError(error);
  const Icon = d.kind === 'offline' ? WifiOff : TriangleAlert;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-card bg-wash-peach p-5">
      <div className="flex items-center gap-2 font-semibold text-ink">
        <Icon aria-hidden className="size-5 text-brand-orange-ink" />
        {d.kind === 'offline' ? 'Sem conexão' : d.kind === 'expired' ? 'Sessão expirada' : 'Não foi possível carregar'}
      </div>
      <p className="text-sm text-ink-muted">
        {d.kind === 'offline'
          ? 'Conecte-se à internet ou ative o uso offline em Configurações para ver dados já baixados neste dispositivo.'
          : d.message}
      </p>
      {d.kind === 'expired' ? (
        <Link href="/entrar?sessao=expirada" className="inline-flex min-h-11 items-center font-semibold text-brand-teal-ink underline">
          Entrar novamente
        </Link>
      ) : (
        onRetry && (
          <Button size="sm" onClick={onRetry} icon={<RefreshCw aria-hidden className="size-4" />}>
            Tentar novamente
          </Button>
        )
      )}
    </div>
  );
}

/** Shows "Salvo neste dispositivo" vs "Salvo" after a mutation (never conflate with synced). */
export function PersistenceNote({ persistence, what = 'Registro salvo' }: { persistence: 'server' | 'local' | null; what?: string }) {
  if (!persistence) return null;
  return (
    <p role="status" className={cx('rounded-field px-3 py-2 text-sm font-medium', persistence === 'local' ? 'bg-wash-sun text-[#524700]' : 'bg-brand-teal-wash text-brand-teal-ink')}>
      {persistence === 'local' ? 'Salvo neste dispositivo — será sincronizado quando houver conexão.' : `${what}.`}
    </p>
  );
}
