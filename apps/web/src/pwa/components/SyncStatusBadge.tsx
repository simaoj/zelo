'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CloudOff, RefreshCw, Smartphone, CheckCircle2 } from 'lucide-react';
import { usePwa, useSyncStatus } from '../PwaProvider';
import { hhmm } from '../labels';

/**
 * Compact connection/sync indicator for the app header. "Salvo neste dispositivo" (local, pending)
 * is deliberately distinct from "Sincronizado".
 */
export function SyncStatusBadge() {
  const { sync, openConflicts } = usePwa();
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine !== false);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const online = browserOnline && (status?.online ?? true);
  const enabled = status?.offlineEnabled ?? false;
  const pending = status?.pendingCount ?? 0;
  const conflicts = (status?.conflictCount ?? 0) + (status?.errorCount ?? 0);
  const last = hhmm(status?.lastSyncedAt ?? null);

  if (online && !enabled && !status?.needsReauth) return null; // nothing to report

  let label: string;
  let tone = 'bg-surface text-ink border-line';
  let Icon = CheckCircle2;
  if (!online) {
    label = pending > 0 ? `Offline · ${pending === 1 ? '1 pendente' : `${pending} pendentes`}` : 'Offline';
    tone = 'bg-wash-sun text-ink border-[#efe2a6]';
    Icon = CloudOff;
  } else if (conflicts > 0) {
    label = conflicts === 1 ? '1 conflito' : `${conflicts} conflitos`;
    tone = 'bg-danger-wash text-ink border-[#f3b8b1]';
    Icon = AlertTriangle;
  } else if (pending > 0) {
    label = pending === 1 ? '1 pendente' : `${pending} pendentes`;
    tone = 'bg-wash-peach text-ink border-[#f6d6bf]';
    Icon = Smartphone;
  } else if (status?.syncing) {
    label = 'Sincronizando…';
    Icon = RefreshCw;
  } else {
    label = 'Sincronizado';
    tone = 'bg-brand-teal-wash text-brand-teal-ink border-[#c4e6e6]';
  }

  const syncNow = async () => {
    if (!sync) return;
    setBusy(true);
    try {
      await sync.syncNow();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold ${tone}`}
      >
        <Icon aria-hidden className={`size-4 ${status?.syncing ? 'motion-safe:animate-spin' : ''}`} />
        <span>{label}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Estado da sincronização"
          className="absolute right-0 z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-ink shadow-[var(--shadow-float)]"
        >
          <p className="font-semibold">{online ? 'Conectado' : 'Offline'}</p>
          {enabled ? (
            <ul className="mt-2 space-y-1 text-ink-muted">
              <li>{last ? `Última sincronização ${last}` : 'Ainda não sincronizado'}</li>
              <li>
                {pending > 0
                  ? `${pending === 1 ? '1 alteração' : `${pending} alterações`}: Salvo neste dispositivo (aguardando envio)`
                  : 'Tudo sincronizado com o servidor'}
              </li>
              {status?.needsReauth ? <li className="font-semibold text-danger">Sessão expirada: entre novamente para sincronizar.</li> : null}
            </ul>
          ) : (
            <p className="mt-2 text-ink-muted">
              {online ? 'Uso offline desativado neste dispositivo.' : 'Sem conexão. Ative o uso offline em Configurações para consultar e registrar dados sem internet.'}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-2">
            {enabled ? (
              <button
                type="button"
                onClick={() => void syncNow()}
                disabled={!online || busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[14px] bg-brand-orange px-4 font-semibold text-ink disabled:opacity-60"
              >
                <RefreshCw aria-hidden className={`size-4 ${busy ? 'motion-safe:animate-spin' : ''}`} />
                Sincronizar agora
              </button>
            ) : null}
            {conflicts > 0 || pending > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openConflicts();
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-[14px] border border-line bg-surface px-4 font-semibold"
              >
                {conflicts > 0 ? 'Resolver conflitos' : 'Ver pendências'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
