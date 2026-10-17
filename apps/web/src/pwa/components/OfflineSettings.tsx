'use client';
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { usePwa, useSyncStatus } from '../PwaProvider';
import { hhmm } from '../labels';

/** Per-device opt-in for offline personal data (spec §9). */
export function OfflineSettings() {
  const { sync, openConflicts } = usePwa();
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!sync || !status) return null;

  const supported = typeof indexedDB !== 'undefined';
  const enabled = status.offlineEnabled;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      if (enabled) {
        await sync.disableOffline();
        setOk('Uso offline desativado. Os dados locais foram apagados deste dispositivo.');
      } else {
        await sync.enableOffline();
        setOk('Pronto! Seus dados foram baixados para este dispositivo.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  };

  const last = hhmm(status.lastSyncedAt);
  return (
    <section aria-labelledby="offline-settings" className="rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="offline-settings" className="font-semibold text-ink">
            Usar offline neste dispositivo
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Seus registros ficam guardados neste dispositivo para consultar e registrar peso, medidas, pressão e tomadas sem internet. Eles são
            sincronizados quando a conexão voltar. Os dados locais não são criptografados: ative apenas em um dispositivo pessoal.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="offline-settings"
          disabled={busy || !supported || (!enabled && !status.online)}
          onClick={() => void toggle()}
          className={`relative mt-1 inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-brand-teal-ink' : 'bg-line'}`}
        >
          <span className={`inline-block size-6 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-7' : 'translate-x-1'}`} />
        </button>
      </div>
      {!supported ? <p className="mt-2 text-sm text-ink-muted">Este navegador não oferece armazenamento local (IndexedDB).</p> : null}
      {!enabled && !status.online ? <p className="mt-2 text-sm text-ink-muted">Conecte-se à internet para ativar.</p> : null}
      {enabled ? (
        <div className="mt-3 flex flex-col gap-2 text-sm text-ink-muted">
          <p>
            {last ? `Última sincronização ${last}` : 'Ainda não sincronizado'} · {status.pendingCount} pendente(s)
            {status.conflictCount ? ` · ${status.conflictCount} conflito(s)` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!status.online} pending={status.syncing} onClick={() => void sync.syncNow()}>
              Sincronizar agora
            </Button>
            {status.pendingCount + status.conflictCount + status.errorCount > 0 ? (
              <Button size="sm" variant="ghost" onClick={openConflicts}>
                Ver pendências
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p role="status" className="mt-2 text-sm text-brand-teal-ink">
          {ok}
        </p>
      ) : null}
    </section>
  );
}
