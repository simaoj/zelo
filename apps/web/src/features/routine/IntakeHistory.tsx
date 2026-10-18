'use client';
import { useState } from 'react';
import type { IntakeRecord } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { usePagedHistory } from '@/shared/data/usePagedHistory';
import { useSubmit } from '@/shared/data/useSubmit';
import { useIntent } from '@/shared/data/intent';
import { useDirtyGuard } from '@/shared/data/useDirtyGuard';
import { describeInstant } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { SectionTitle } from '@/shared/ui/Card';
import { ConfirmDialog, Dialog } from '@/shared/ui/Dialog';
import { DateTimeFields, fromInstant, resolveInstant } from '@/shared/ui/DateTimeFields';
import { FormError, TextAreaField } from '@/shared/ui/Field';
import { ConflictActions } from '@/shared/ui/ConflictActions';
import { RowActions } from '@/shared/ui/RowActions';
import { EmptyState, ErrorState, LoadingState } from '@/shared/ui/States';
import { useToast } from '@/shared/ui/Toast';
import { formatDose } from './occurrenceLogic';

export function IntakeHistory() {
  const history = usePagedHistory<IntakeRecord>('intakes', (ds, q) => ds.listIntakes(q));
  const { data } = useZelo();
  const tz = useTimeZone();
  const toast = useToast();
  const [editing, setEditing] = useState<IntakeRecord | null>(null);
  const [removing, setRemoving] = useState<IntakeRecord | null>(null);
  const deletion = useSubmit();
  const intent = useIntent();
  const remove = async () => {
    if (!removing) return;
    const ok = await deletion.run(async () => {
      await data.deleteIntake(removing.id, { operationId: intent.current().operationId, expectedVersion: removing.version });
      return true;
    }, { onServerError: () => intent.rotateOperation() });
    if (ok) {
      setRemoving(null);
      toast({ message: 'Registro de tomada excluído' });
    }
  };
  return (
    <section aria-labelledby="intake-history" className="flex min-w-0 flex-col gap-3">
      <SectionTitle id="intake-history" accent="teal">Histórico de tomadas</SectionTitle>
      <p className="text-sm text-ink-muted">Tomadas avulsas e decisões dos horários programados. Editar ou excluir registros neste histórico exige conexão.</p>
      {history.error ? <ErrorState error={history.error} onRetry={history.reload} /> : null}
      {!history.loaded && history.loading ? <LoadingState /> : history.loaded && history.items.length === 0 ? <EmptyState title="Nenhuma tomada registrada" /> : null}
      <ul className="flex flex-col gap-2">
        {history.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface p-4 shadow-card">
            <div className="min-w-0 flex-1 break-words">
              <h3 className="font-semibold">{item.nameSnapshot}</h3>
              <p className="text-sm">{formatDose(item.doseSnapshot, item.unitSnapshot)} • {item.occurrenceId ? 'Programada' : 'Avulsa'}</p>
              <p className="text-sm text-ink-muted">{item.status === 'taken' ? `Tomado • ${describeInstant(item.actualTakenAt!, tz)}` : 'Não tomado'}</p>
              {item.notes && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{item.notes}</p>}
            </div>
            <RowActions label={`tomada de ${item.nameSnapshot}`} onEdit={() => setEditing(item)} onDelete={() => { intent.reset(); deletion.setError(null); setRemoving(item); }} />
          </li>
        ))}
      </ul>
      {history.hasMore && <Button pending={history.loading} onClick={() => void history.loadMore()}>Carregar mais tomadas</Button>}
      {editing && <EditIntake key={editing.id} item={editing} onClose={() => setEditing(null)} onReload={() => { setEditing(null); history.reload(); }} />}
      <ConfirmDialog open={!!removing} title="Excluir registro de tomada?" description="A tomada avulsa será removida. Para um horário programado, a decisão será desfeita." confirmLabel="Excluir" pending={deletion.pending} error={deletion.error?.message} onConfirm={() => void remove()} onClose={() => setRemoving(null)} />
    </section>
  );
}

function EditIntake({ item, onClose, onReload }: { item: IntakeRecord; onClose: () => void; onReload: () => void }) {
  const { data } = useZelo();
  const tz = useTimeZone();
  const intent = useIntent();
  const guard = useDirtyGuard();
  const submit = useSubmit();
  const [when, setWhen] = useState(() => fromInstant(item.actualTakenAt ?? item.createdAt, tz));
  const [notes, setNotes] = useState(item.notes ?? '');
  const [whenError, setWhenError] = useState<string>();
  return (
    <Dialog open onClose={onClose} title="Editar tomada" description={`${item.nameSnapshot} • ${formatDose(item.doseSnapshot, item.unitSnapshot)}`}>
      <form className="flex flex-col gap-4" noValidate onChange={guard.markDirty} data-zelo-editing={guard.dirty || undefined} onSubmit={async (event) => {
        event.preventDefault();
        const time = resolveInstant(when, tz);
        if (item.status === 'taken' && !time.ok) { setWhenError(time.error); return; }
        setWhenError(undefined);
        const result = await submit.run(() => data.updateIntake(item.id, {
          operationId: intent.current().operationId, expectedVersion: item.version,
          ...(item.status === 'taken' && time.ok ? { actualTakenAt: time.iso } : {}), notes: notes.trim() || null,
        }), { onServerError: () => intent.rotateOperation() });
        if (result) onClose();
      }}>
        {item.status === 'taken' && <DateTimeFields value={when} onChange={setWhen} tz={tz} error={whenError} timeLabel="Horário real" />}
        <TextAreaField label="Observação" optional maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {submit.error && <FormError>{submit.error.message}{submit.error.kind === 'conflict' && <ConflictActions onReload={onReload} />}</FormError>}
        <Button type="submit" variant="primary" pending={submit.pending}>Salvar</Button>
      </form>
    </Dialog>
  );
}
