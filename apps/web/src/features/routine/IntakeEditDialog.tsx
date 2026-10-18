'use client';
import { useState } from 'react';
import type { IntakeStatus, Occurrence } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { useDirtyGuard } from '@/shared/data/useDirtyGuard';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { FormError, TextAreaField } from '@/shared/ui/Field';
import { DateTimeFields, fromInstant, nowInTz, resolveInstant } from '@/shared/ui/DateTimeFields';
import { useToast } from '@/shared/ui/Toast';
import { formatDose } from './occurrenceLogic';

/** Confirm/edit an intake decision: real time (defaults to now, never future), status and note. */
export function IntakeEditDialog({ occurrence: o, tz, onClose }: { occurrence: Occurrence; tz: string; onClose: () => void }) {
  const { data } = useZelo();
  const toast = useToast();
  const intent = useIntent();
  const guard = useDirtyGuard();
  const { pending, error, run } = useSubmit();
  const [status, setStatus] = useState<IntakeStatus>(o.intake?.status ?? 'taken');
  const [when, setWhen] = useState(() => (o.intake?.actualTakenAt ? fromInstant(o.intake.actualTakenAt, tz) : nowInTz(tz)));
  const [notes, setNotes] = useState(o.intake?.notes ?? '');
  const [whenError, setWhenError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let iso: string | null = null;
    if (status === 'taken') {
      const t = resolveInstant(when, tz);
      setWhenError(t.ok ? undefined : t.error);
      if (!t.ok) return;
      iso = t.iso;
    }
    const i = intent.current();
    const trimmed = notes.trim();
    const r = await run(
      () =>
        data.putOccurrenceIntake(o.id, {
          operationId: i.operationId,
          intakeId: o.intake?.id ?? i.id,
          status,
          actualTakenAt: iso,
          notes: trimmed === '' ? null : trimmed,
          ...(o.intake ? { expectedVersion: o.intake.version } : {}),
        }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (r) {
      toast({ message: r.persistence === 'local' ? 'Salvo neste dispositivo' : 'Registro atualizado' });
      onClose();
    }
  };

  return (
    <Dialog open onClose={onClose} title={o.nameSnapshot} description={`Programado para ${o.localTime} • ${formatDose(o.doseSnapshot, o.unitSnapshot)}`}>
      <form onChange={guard.markDirty} data-zelo-editing={guard.dirty || undefined} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">Decisão</legend>
          {(['taken', 'not_taken'] as const).map((s) => (
            <label key={s} className="flex min-h-11 items-center gap-3 rounded-field bg-surface-muted px-3">
              <input type="radio" name="status" value={s} checked={status === s} onChange={() => setStatus(s)} className="size-5 accent-[#006a6a]" />
              <span className="text-sm font-semibold">{s === 'taken' ? 'Tomado' : 'Não tomado'}</span>
            </label>
          ))}
        </fieldset>
        {status === 'taken' && <DateTimeFields value={when} onChange={setWhen} tz={tz} error={whenError} timeLabel="Horário real" dateLabel="Data" />}
        <TextAreaField label="Observação" optional maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <FormError>{error.message}</FormError>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" pending={pending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
