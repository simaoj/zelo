'use client';
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { WaterEntry } from '@zelo/contracts';
import type { Mutation } from '@/shared/data/ports';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { useDirtyGuard } from '@/shared/data/useDirtyGuard';
import { fieldError } from '@/shared/data/errors';
import { Button } from '@/shared/ui/Button';
import { FormError, TextAreaField, TextField } from '@/shared/ui/Field';
import { DateTimeFields, fromInstant, nowInTz, resolveInstant, type DateTimeValue } from '@/shared/ui/DateTimeFields';
import { ConflictActions } from '@/shared/ui/ConflictActions';
import { parseWaterMl } from './waterLogic';

/** Custom water entry (any integer ml, any past date/time) — create or edit. */
export function WaterForm({
  entry,
  initialWhen,
  onDone,
  onCancel,
  onConflict,
}: {
  entry?: WaterEntry;
  /** default date/time for a new entry (defaults to now) */
  initialWhen?: DateTimeValue;
  onDone: (m: Mutation<WaterEntry>) => void;
  onCancel?: () => void;
  onConflict?: () => void;
}) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const intent = useIntent();
  const { pending, error, run } = useSubmit();
  const guard = useDirtyGuard();
  const [amount, setAmount] = useState(entry ? String(entry.amountMl) : '');
  const [when, setWhen] = useState<DateTimeValue>(() => (entry ? fromInstant(entry.consumedAt, tz) : (initialWhen ?? nowInTz(tz))));
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [errors, setErrors] = useState<{ amount?: string; when?: string }>({});

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseWaterMl(amount);
    const t = resolveInstant(when, tz);
    setErrors({ amount: a.ok ? undefined : a.error, when: t.ok ? undefined : t.error });
    if (!a.ok || !t.ok) return;
    const i = intent.current();
    const trimmed = notes.trim();
    const result = await run(
      () =>
        entry
          ? data.updateWaterEntry(entry.id, {
              operationId: i.operationId,
              expectedVersion: entry.version,
              consumedAt: t.iso,
              timezone: tz,
              amountMl: a.value,
              notes: trimmed === '' ? null : trimmed,
            })
          : data.createWaterEntry({ id: i.id, operationId: i.operationId, consumedAt: t.iso, timezone: tz, amountMl: a.value, ...(trimmed ? { notes: trimmed } : {}) }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (result) {
      intent.reset();
      guard.clear();
      if (!entry) {
        setAmount('');
        setNotes('');
        setWhen(nowInTz(tz));
      }
      onDone(result);
    }
  };

  const fe = error?.fieldErrors ?? {};
  return (
    <form onChange={guard.markDirty} data-zelo-editing={guard.dirty || undefined} onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField
        label="Quantidade"
        required
        inputMode="numeric"
        autoComplete="off"
        placeholder="Ex.: 250"
        suffix="ml"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={errors.amount ?? fieldError(fe, 'amountMl')}
        hint="Número inteiro de mililitros."
        data-autofocus
      />
      <DateTimeFields value={when} onChange={setWhen} tz={tz} error={errors.when ?? fieldError(fe, 'consumedAt')} />
      <TextAreaField label="Observação" optional maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && (
        <FormError>
          {error.kind === 'validation' ? 'Confira os campos destacados.' : error.message}
          {error.kind === 'conflict' && <ConflictActions onReload={onConflict} />}
        </FormError>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" variant="primary" size="lg" pending={pending} icon={<Check aria-hidden className="size-5" />}>
          {entry ? 'Salvar alterações' : 'Registrar água'}
        </Button>
      </div>
    </form>
  );
}
