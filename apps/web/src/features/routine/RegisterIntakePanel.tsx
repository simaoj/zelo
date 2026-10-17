'use client';
import { Check } from 'lucide-react';
import { useResource } from '@/shared/data/hooks';
import { useTimeZone } from '@/shared/data/session';
import { todayIn } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { ErrorState, LoadingState } from '@/shared/ui/States';
import { useToast } from '@/shared/ui/Toast';
import { AdHocIntakeForm } from './AdHocIntakeForm';
import { effectiveState, formatDose, isDecided } from './occurrenceLogic';
import { useOccurrenceActions } from './useOccurrenceActions';

/** "Registrar → Tomada": pending occurrences of today + ad-hoc intake. */
export function RegisterIntakePanel({ onDone }: { onDone: () => void }) {
  const tz = useTimeZone();
  const date = todayIn(tz);
  const occ = useResource(`occurrences:${date}`, (ds) => ds.listOccurrences(date));
  const { markTaken, pending } = useOccurrenceActions();
  const toast = useToast();
  const open = (occ.data?.items ?? []).filter((o) => !isDecided(effectiveState(o)));

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="pend-title" className="flex flex-col gap-2">
        <h3 id="pend-title" className="text-sm font-semibold uppercase tracking-[0.06em] text-ink-muted">
          Programados para hoje
        </h3>
        {occ.loading && !occ.data ? (
          <LoadingState />
        ) : occ.error ? (
          <ErrorState error={occ.error} onRetry={occ.reload} />
        ) : open.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum horário pendente hoje.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {open.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-field bg-surface p-3 shadow-card">
                <div className="min-w-0 flex-1">
                  <p className="tabular text-xs font-bold text-brand-orange-ink">{o.localTime}</p>
                  <p className="font-semibold">{o.nameSnapshot}</p>
                  <p className="text-xs text-ink-muted">{formatDose(o.doseSnapshot, o.unitSnapshot)}</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  pending={!!pending[o.id]}
                  onClick={async () => {
                    if (await markTaken(o)) onDone();
                  }}
                  icon={<Check aria-hidden className="size-4" />}
                >
                  Marcar como tomado
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="adhoc-title" className="flex flex-col gap-3">
        <h3 id="adhoc-title" className="text-sm font-semibold uppercase tracking-[0.06em] text-ink-muted">
          Tomada avulsa
        </h3>
        <AdHocIntakeForm
          onDone={(m) => {
            toast({ message: m.persistence === 'local' ? 'Tomada salva neste dispositivo' : 'Tomada avulsa registrada' });
            onDone();
          }}
        />
      </section>
    </div>
  );
}
