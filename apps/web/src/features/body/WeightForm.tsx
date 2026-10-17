'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Mutation } from '@/shared/data/ports';
import type { WeightEntry } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { fieldError } from '@/shared/data/errors';
import { normalizeDecimal } from '@/shared/lib/decimal';
import { Button } from '@/shared/ui/Button';
import { TextAreaField, TextField, FormError } from '@/shared/ui/Field';
import { DateTimeFields, fromInstant, nowInTz, resolveInstant } from '@/shared/ui/DateTimeFields';
import { ConflictActions } from '@/shared/ui/ConflictActions';

export function WeightForm({
  entry,
  onDone,
  onCancel,
  onConflict,
}: {
  entry?: WeightEntry;
  onDone: (m: Mutation<WeightEntry>) => void;
  onCancel?: () => void;
  onConflict?: () => void;
}) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const intent = useIntent();
  const { pending, error, run } = useSubmit();
  const [weight, setWeight] = useState(entry ? entry.weightKg.replace('.', ',') : '');
  const [when, setWhen] = useState(() => (entry ? fromInstant(entry.measuredAt, entry.timezone) : nowInTz(tz)));
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [errors, setErrors] = useState<{ weight?: string; when?: string; notes?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = normalizeDecimal(weight, 2);
    const t = resolveInstant(when, tz);
    const next = {
      weight: w.ok ? undefined : w.error,
      when: t.ok ? undefined : t.error,
      notes: notes.length > 1000 ? 'Use até 1000 caracteres' : undefined,
    };
    setErrors(next);
    if (!w.ok || !t.ok || next.notes) return;
    const i = intent.current();
    const trimmed = notes.trim();
    const result = await run(
      () =>
        entry
          ? data.updateWeight(entry.id, {
              operationId: i.operationId,
              expectedVersion: entry.version,
              measuredAt: t.iso,
              timezone: tz,
              weightKg: w.value,
              notes: trimmed === '' ? null : trimmed,
            })
          : data.createWeight({
              id: i.id,
              operationId: i.operationId,
              measuredAt: t.iso,
              timezone: tz,
              weightKg: w.value,
              ...(trimmed ? { notes: trimmed } : {}),
            }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (result) {
      intent.reset();
      if (!entry) {
        setWeight('');
        setNotes('');
        setWhen(nowInTz(tz));
      }
      onDone(result);
    }
  };

  const fe = error?.fieldErrors ?? {};
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Peso (kg)"
        required
        inputMode="decimal"
        autoComplete="off"
        placeholder="Ex.: 82,35"
        suffix="kg"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        error={errors.weight ?? fieldError(fe, 'weightKg')}
        hint="Aceita vírgula, até duas casas decimais."
        data-autofocus
      />
      <DateTimeFields value={when} onChange={setWhen} tz={tz} error={errors.when ?? fieldError(fe, 'measuredAt')} />
      <TextAreaField
        label="Observação"
        optional
        maxLength={1000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        error={errors.notes ?? fieldError(fe, 'notes')}
      />
      {error && error.kind !== 'validation' && (
        <FormError>
          {error.message}
          {error.kind === 'conflict' && <ConflictActions onReload={onConflict} />}
        </FormError>
      )}
      {error?.kind === 'validation' && <FormError>Confira os campos destacados.</FormError>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button onClick={onCancel} variant="secondary">
            Cancelar
          </Button>
        )}
        <Button type="submit" variant="primary" size="lg" pending={pending} icon={<Check aria-hidden className="size-5" />}>
          {entry ? 'Salvar alterações' : 'Salvar registro'}
        </Button>
      </div>
    </form>
  );
}
