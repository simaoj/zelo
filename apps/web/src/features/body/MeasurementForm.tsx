'use client';
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { MEASUREMENT_LABELS, SIDE_LABELS, type MeasurementSession, type Side } from '@zelo/contracts';
import type { Mutation } from '@/shared/data/ports';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { useDirtyGuard } from '@/shared/data/useDirtyGuard';
import { Button } from '@/shared/ui/Button';
import { FormError, TextAreaField } from '@/shared/ui/Field';
import { DateTimeFields, fromInstant, nowInTz, resolveInstant } from '@/shared/ui/DateTimeFields';
import { ConflictActions } from '@/shared/ui/ConflictActions';
import { buildMeasurementValues, defaultRows, isSided, rowsFromSession, sortRows, type MeasurementRow } from './measurementLogic';

const SIDES: Side[] = ['unspecified', 'left', 'right'];

export function MeasurementForm({
  session,
  onDone,
  onCancel,
  onConflict,
}: {
  session?: MeasurementSession;
  onDone: (m: Mutation<MeasurementSession>) => void;
  onCancel?: () => void;
  onConflict?: () => void;
}) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const intent = useIntent();
  const { pending, error, run } = useSubmit();
  const [rows, setRows] = useState<MeasurementRow[]>(() => (session ? rowsFromSession(session) : defaultRows()));
  const [when, setWhen] = useState(() => (session ? fromInstant(session.measuredAt, session.timezone) : nowInTz(tz)));
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [whenError, setWhenError] = useState<string | undefined>();
  const guard = useDirtyGuard();

  const update = (key: string, patch: Partial<MeasurementRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addSide = (row: MeasurementRow) => {
    const used = rows.filter((r) => r.type === row.type).map((r) => r.side);
    const side = (['left', 'right', 'unspecified'] as Side[]).find((s) => !used.includes(s)) ?? 'unspecified';
    setRows((rs) => sortRows([...rs, { key: `${row.type}-${Date.now()}`, type: row.type, side, value: '' }]));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const built = buildMeasurementValues(rows);
    const t = resolveInstant(when, tz);
    setWhenError(t.ok ? undefined : t.error);
    setRowErrors(built.ok ? {} : built.rowErrors);
    setFormError(built.ok ? undefined : built.formError);
    if (!built.ok || !t.ok) return;
    const i = intent.current();
    const trimmed = notes.trim();
    const result = await run(
      () =>
        session
          ? data.updateMeasurement(session.id, {
              operationId: i.operationId,
              expectedVersion: session.version,
              measuredAt: t.iso,
              timezone: tz,
              notes: trimmed === '' ? null : trimmed,
              values: built.values,
            })
          : data.createMeasurement({
              id: i.id,
              operationId: i.operationId,
              measuredAt: t.iso,
              timezone: tz,
              values: built.values,
              ...(trimmed ? { notes: trimmed } : {}),
            }),
      { onServerError: () => intent.rotateOperation() },
    );
    if (result) {
      intent.reset();
      if (!session) {
        setRows(defaultRows());
        setNotes('');
        setWhen(nowInTz(tz));
      }
      guard.clear();
      onDone(result);
    }
  };

  return (
    <form
      onChange={guard.markDirty}
      data-zelo-editing={guard.dirty || undefined} onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm text-ink-muted">Preencha só as medidas que fez agora (em cm). Campos vazios não são salvos.</legend>
        {rows.map((row, idx) => {
          const sided = isSided(row.type);
          const inputId = `m-${row.key}`;
          const err = rowErrors[row.key];
          const firstOfType = rows.findIndex((r) => r.type === row.type) === idx;
          const countOfType = rows.filter((r) => r.type === row.type).length;
          return (
            <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
              <label htmlFor={inputId} className="col-span-2 text-[13px] font-semibold text-ink sm:col-span-1 sm:pb-3.5">
                {MEASUREMENT_LABELS[row.type]}
              </label>
              <div className="flex min-w-0 gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    id={inputId}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="—"
                    value={row.value}
                    onChange={(e) => update(row.key, { value: e.target.value })}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `${inputId}-err` : undefined}
                    className="tabular min-h-12 w-full rounded-field border border-transparent bg-surface-muted px-3.5 pr-11 text-base focus:border-brand-teal focus:bg-surface focus:outline-none aria-[invalid=true]:border-danger"
                  />
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-ink-muted">
                    cm
                  </span>
                </div>
                {sided && (
                  <select
                    aria-label={`Lado — ${MEASUREMENT_LABELS[row.type]}`}
                    value={row.side}
                    onChange={(e) => update(row.key, { side: e.target.value as Side })}
                    className="min-h-12 w-[8.5rem] shrink-0 rounded-field bg-surface-muted px-2 text-sm"
                  >
                    {SIDES.map((s) => (
                      <option key={s} value={s}>
                        {s === 'unspecified' ? 'Lado não especificado' : `Lado ${SIDE_LABELS[s]}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex">
                {sided && firstOfType && countOfType < 3 ? (
                  <button
                    type="button"
                    onClick={() => addSide(row)}
                    className="inline-flex size-11 items-center justify-center rounded-full text-brand-teal-ink hover:bg-brand-teal-wash"
                  >
                    <Plus aria-hidden className="size-5" />
                    <span className="sr-only">Adicionar outro lado de {MEASUREMENT_LABELS[row.type]}</span>
                  </button>
                ) : sided && !firstOfType ? (
                  <button
                    type="button"
                    onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                    className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
                  >
                    <X aria-hidden className="size-5" />
                    <span className="sr-only">Remover esta linha de {MEASUREMENT_LABELS[row.type]}</span>
                  </button>
                ) : (
                  <span className="size-11" aria-hidden />
                )}
              </div>
              {err && (
                <p id={`${inputId}-err`} role="alert" className="col-span-full text-xs font-semibold text-danger">
                  {err}
                </p>
              )}
            </div>
          );
        })}
      </fieldset>
      <DateTimeFields value={when} onChange={setWhen} tz={tz} error={whenError} />
      <TextAreaField label="Observação" optional maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {formError && <FormError>{formError}</FormError>}
      {error && (
        <FormError>
          {error.kind === 'validation' ? `${error.message} Confira os valores informados.` : error.message}
          {error.kind === 'conflict' && <ConflictActions onReload={onConflict} />}
        </FormError>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && <Button onClick={onCancel}>Cancelar</Button>}
        <Button type="submit" variant="primary" size="lg" pending={pending} icon={<Check aria-hidden className="size-5" />}>
          {session ? 'Salvar alterações' : 'Salvar medidas'}
        </Button>
      </div>
    </form>
  );
}
