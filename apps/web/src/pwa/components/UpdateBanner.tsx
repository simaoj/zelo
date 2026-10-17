'use client';
import { useState, useSyncExternalStore } from 'react';
import { Sparkles } from 'lucide-react';
import { applyUpdate, getWaitingWorker, subscribeSwUpdate } from '../sw-client';
import { pwaGuards } from '../guards';
import { usePwa } from '../PwaProvider';

/**
 * "Nova versão disponível". Applies the update only on user action, never while a form is being
 * edited (pwaGuards) or a sync is running. IndexedDB (queue + drafts) is untouched by updates.
 */
export function UpdateBanner() {
  const { sync } = usePwa();
  const waiting = useSyncExternalStore(subscribeSwUpdate, getWaitingWorker, () => null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  if (!waiting || dismissed) return null;

  const update = () => {
    if (pwaGuards.isEditing()) return setBlocked('Salve ou cancele a edição em andamento antes de atualizar.');
    if (sync?.getStatus().syncing) return setBlocked('Aguarde a sincronização terminar e tente de novo.');
    setBlocked(null);
    applyUpdate();
  };

  return (
    <div role="status" className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-4 text-ink shadow-[var(--shadow-float)] lg:bottom-6">
      <div className="flex items-start gap-3">
        <Sparkles aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-orange-ink" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Nova versão disponível</p>
          <p className="text-sm text-ink-muted">Seus registros e alterações pendentes são preservados.</p>
          {blocked ? <p className="mt-1 text-sm font-medium text-danger">{blocked}</p> : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={update} className="min-h-11 rounded-[14px] bg-brand-orange px-4 text-sm font-semibold text-ink">
              Atualizar
            </button>
            <button type="button" onClick={() => setDismissed(true)} className="min-h-11 rounded-[14px] px-4 text-sm font-semibold text-ink hover:bg-surface-muted">
              Depois
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
