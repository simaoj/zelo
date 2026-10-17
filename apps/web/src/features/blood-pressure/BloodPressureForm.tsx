'use client';
import { useState } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import type { BloodPressureEntry } from '@zelo/contracts';
import type { Mutation } from '@/shared/data/ports';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { fieldError } from '@/shared/data/errors';
import { Button } from '@/shared/ui/Button';
import { FormError, TextAreaField, TextField } from '@/shared/ui/Field';
import { DateTimeFields, fromInstant, nowInTz, resolveInstant } from '@/shared/ui/DateTimeFields';
import { ConflictActions } from '@/shared/ui/ConflictActions';
import { BP_CONFIRM_TEXT, needsConfirmation, parseBp, type BpInput } from './bpLogic';

export function BloodPressureForm({
  entry,
  onDone,
  onCancel,
  onConflict,
}: {
  entry?: BloodPressureEntry;
  onDone: (m: Mutation<BloodPressureEntry>) => void;
  onCancel?: () => void;
  onConflict?: () => void;
}) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const intent = useIntent();
  const { pending, error, setError, run } = useSubmit();
  const [values, setValues] = useState<BpInput>({
    systolic: entry ? String(entry.systolic) : '',
    diastolic: entry ? String(entry.diastolic) : '',
    pulse: entry?.pulseBpm != null ? String(entry.pulseBpm) : '',
  });
  const [when, setWhen] = useState(() => (entry ? fromInstant(entry.measuredAt, entry.timezone) : nowInTz(tz)));
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [errors, setErrors] = useState<Partial<Record<keyof BpInput | 'when', string>>>({});
  const [confirming, setConfirming] = useState(false);

  const set = (k: keyof BpInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setConfirming(false);
  };

  const send = async (confirmed: boolean) => {
    const parsed = parseBp(values);
    const t = resolveInstant(when, tz);
    setErrors({ ...(parsed.ok ? {} : parsed.errors), when: t.ok ? undefined : t.error });
    if (!parsed.ok || !t.ok) return;
    if (!confirmed && needsConfirmation(parsed.systolic, parsed.diastolic)) {
      setConfirming(true);
      return;
    }
    const i = confirmed ? intent.rotateOperation() : intent.current();
    const trimmed = notes.trim();
    const base = {
      operationId: i.operationId,
      measuredAt: t.iso,
      timezone: tz,
      systolic: parsed.systolic,
      diastolic: parsed.diastolic,
      pulseBpm: parsed.pulseBpm,
      ...(confirmed ? { confirmedUnusual: true } : {}),
    };
    const result = await run(
      () =>
        entry
          ? data.updateBloodPressure(entry.id, { ...base, expectedVersion: entry.version, notes: trimmed === '' ? null : trimmed })
          : data.createBloodPressure({ ...base, id: i.id, ...(trimmed ? { notes: trimmed } : {}) }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (result) {
      intent.reset();
      setConfirming(false);
      if (!entry) {
        setValues({ systolic: '', diastolic: '', pulse: '' });
        setNotes('');
        setWhen(nowInTz(tz));
      }
      onDone(result);
    }
  };

  // Server may also ask for confirmation (422 CONFIRMATION_REQUIRED)
  const serverAsksConfirmation = error?.kind === 'confirmation';
  const showConfirm = confirming || serverAsksConfirmation;
  const fe = error?.fieldErrors ?? {};

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send(false);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Sistólica (máxima)"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ex.: 120"
          suffix="mmHg"
          value={values.systolic}
          onChange={set('systolic')}
          error={errors.systolic ?? fieldError(fe, 'systolic')}
          data-autofocus
        />
        <TextField
          label="Diastólica (mínima)"
          required
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ex.: 80"
          suffix="mmHg"
          value={values.diastolic}
          onChange={set('diastolic')}
          error={errors.diastolic ?? fieldError(fe, 'diastolic')}
        />
      </div>
      <TextField
        label="Pulso"
        optional
        inputMode="numeric"
        autoComplete="off"
        placeholder="Ex.: 72"
        suffix="bpm"
        value={values.pulse}
        onChange={set('pulse')}
        error={errors.pulse ?? fieldError(fe, 'pulseBpm')}
        containerClassName="max-w-[50%] pr-1.5"
      />
      <DateTimeFields value={when} onChange={setWhen} tz={tz} error={errors.when ?? fieldError(fe, 'measuredAt')} />
      <TextAreaField label="Observação" optional maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {showConfirm ? (
        <div role="alertdialog" aria-labelledby="bp-confirm-title" className="flex flex-col gap-3 rounded-field border border-brand-yellow bg-wash-sun p-4">
          <p id="bp-confirm-title" className="flex items-start gap-2 text-sm font-semibold text-ink">
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-[#6c5e00]" />
            Confira os valores
          </p>
          <p className="text-sm text-ink">{BP_CONFIRM_TEXT}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Corrigir valores
            </Button>
            <Button variant="primary" pending={pending} onClick={() => void send(true)}>
              Os valores estão corretos
            </Button>
          </div>
        </div>
      ) : (
        <>
          {error && error.kind !== 'confirmation' && (
            <FormError>
              {error.kind === 'validation' ? 'Confira os campos destacados.' : error.message}
              {error.kind === 'conflict' && <ConflictActions onReload={onConflict} />}
            </FormError>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
            <Button type="submit" variant="primary" size="lg" pending={pending} icon={<Check aria-hidden className="size-5" />}>
              {entry ? 'Salvar alterações' : 'Registrar pressão'}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
