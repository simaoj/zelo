'use client';
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { FREQUENCIES, ROUTINE_TYPES, ROUTINE_TYPE_LABELS, type Frequency, type RoutineItem, type RoutineType } from '@zelo/contracts';
import { useZelo } from '@/shared/data/ZeloProvider';
import { useTimeZone } from '@/shared/data/session';
import { useIntent } from '@/shared/data/intent';
import { useSubmit } from '@/shared/data/useSubmit';
import { useDirtyGuard } from '@/shared/data/useDirtyGuard';
import { uuid } from '@/shared/lib/ids';
import { listTimeZones, todayIn, WEEKDAY_LONG, WEEKDAY_SHORT } from '@/shared/lib/time';
import { Button } from '@/shared/ui/Button';
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from '@/shared/ui/Field';
import { ConflictActions } from '@/shared/ui/ConflictActions';
import { cx } from '@/shared/ui/cx';
import { basicsChanged, buildItemPayload, emptyItemForm, itemToForm, scheduleChanged, type ItemErrors, type ItemFormState } from './itemLogic';

const FREQ_LABELS: Record<Frequency, string> = { daily: 'Todos os dias', weekly: 'Dias da semana', none: 'Sem programação' };

export function ItemForm({ item, onDone, onCancel, onConflict }: { item?: RoutineItem; onDone: (i: RoutineItem) => void; onCancel: () => void; onConflict?: () => void }) {
  const tz = useTimeZone();
  const { data } = useZelo();
  const intent = useIntent();
  const { pending, error, run } = useSubmit();
  const zones = useMemo(() => listTimeZones(), []);
  const [f, setF] = useState<ItemFormState>(() => (item ? itemToForm(item, todayIn(tz), tz) : emptyItemForm(todayIn(tz), tz)));
  const [errors, setErrors] = useState<ItemErrors>({});
  const guard = useDirtyGuard();
  const set = <K extends keyof ItemFormState>(k: K, v: ItemFormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const built = buildItemPayload(f);
  const willRevise = item && built.ok && scheduleChanged(item, built.value);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = buildItemPayload(f);
    if (!b.ok) {
      setErrors(b.errors);
      return;
    }
    setErrors({});
    const p = b.value;
    const i = intent.current();
    const result = await run(
      async () => {
        if (!item) {
          return data.createRoutineItem({
            id: i.id,
            operationId: i.operationId,
            name: p.name,
            type: p.type,
            dose: p.dose,
            unit: p.unit,
            ...(p.instructions ? { instructions: p.instructions } : {}),
            schedule: p.schedule,
          });
        }
        let current = item;
        if (basicsChanged(item, p)) {
          current = await data.updateRoutineItem(item.id, {
            operationId: i.operationId,
            expectedVersion: current.version,
            name: p.name,
            type: p.type,
            instructions: p.instructions,
          });
        }
        if (scheduleChanged(item, p)) {
          current = await data.reviseSchedule(item.id, {
            operationId: basicsChanged(item, p) ? uuid() : i.operationId,
            expectedVersion: current.version,
            dose: p.dose,
            unit: p.unit,
            schedule: p.schedule,
          });
        }
        return current;
      },
      { onServerError: () => intent.rotateOperation() },
    );
    if (result) {
      intent.reset();
      guard.clear();
      onDone(result);
    }
  };

  const fe = error?.fieldErrors ?? {};
  const fieldErr = (k: keyof ItemFormState, ...server: string[]) => errors[k] ?? server.map((s) => fe[s]?.[0]).find(Boolean);

  return (
    <form
      onChange={guard.markDirty}
      data-zelo-editing={guard.dirty || undefined} onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField label="Nome" required maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} error={fieldErr('name', 'name')} data-autofocus />
      <SelectField label="Tipo" required value={f.type} onChange={(e) => set('type', e.target.value as RoutineType)}>
        {ROUTINE_TYPES.map((t) => (
          <option key={t} value={t}>
            {ROUTINE_TYPE_LABELS[t]}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Dose" required inputMode="decimal" placeholder="Ex.: 1 ou 0,5" value={f.dose} onChange={(e) => set('dose', e.target.value)} error={fieldErr('dose', 'dose')} />
        <TextField label="Unidade" required placeholder="comprimido, gotas, mg…" maxLength={30} value={f.unit} onChange={(e) => set('unit', e.target.value)} error={fieldErr('unit', 'unit')} />
      </div>
      <TextAreaField label="Instruções pessoais" optional maxLength={1000} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} error={fieldErr('instructions', 'instructions')} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-semibold">Frequência</legend>
        <div className="flex flex-wrap gap-2">
          {FREQUENCIES.map((fr) => (
            <label
              key={fr}
              className={cx(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brand-teal',
                f.frequency === fr ? 'bg-brand-teal-ink text-white' : 'bg-surface-muted text-ink',
              )}
            >
              <input type="radio" name="frequency" value={fr} checked={f.frequency === fr} onChange={() => set('frequency', fr)} className="sr-only" />
              {FREQ_LABELS[fr]}
            </label>
          ))}
        </div>
      </fieldset>

      {f.frequency === 'weekly' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">Dias da semana</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_SHORT.map((d, idx) => {
              const on = f.weekdays.includes(idx);
              return (
                <label
                  key={d}
                  className={cx(
                    'flex size-12 cursor-pointer items-center justify-center rounded-full text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-brand-teal',
                    on ? 'bg-brand-orange text-ink' : 'bg-surface-muted text-ink-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    aria-label={WEEKDAY_LONG[idx]}
                    onChange={() => set('weekdays', on ? f.weekdays.filter((x) => x !== idx) : [...f.weekdays, idx])}
                  />
                  <span aria-hidden>{d}</span>
                </label>
              );
            })}
          </div>
          {fieldErr('weekdays', 'schedule.weekdays') && (
            <p role="alert" className="text-xs font-semibold text-danger">
              {fieldErr('weekdays', 'schedule.weekdays')}
            </p>
          )}
        </fieldset>
      )}

      {f.frequency !== 'none' && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold">Horários fixos</legend>
          {f.times.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="time"
                aria-label={`Horário ${idx + 1}`}
                value={t}
                onChange={(e) => set('times', f.times.map((x, j) => (j === idx ? e.target.value : x)))}
                className="tabular min-h-12 flex-1 rounded-field bg-surface-muted px-3.5 text-base"
              />
              {f.times.length > 1 && (
                <button
                  type="button"
                  onClick={() => set('times', f.times.filter((_, j) => j !== idx))}
                  className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted"
                >
                  <X aria-hidden className="size-5" />
                  <span className="sr-only">Remover horário {t}</span>
                </button>
              )}
            </div>
          ))}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => set('times', [...f.times, ''])} icon={<Plus aria-hidden className="size-4" />}>
            Adicionar horário
          </Button>
          {fieldErr('times', 'schedule.times') && (
            <p role="alert" className="text-xs font-semibold text-danger">
              {fieldErr('times', 'schedule.times')}
            </p>
          )}
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <TextField label="Início" type="date" required value={f.startDate} onChange={(e) => set('startDate', e.target.value)} error={fieldErr('startDate', 'schedule.startDate')} />
        <TextField label="Término" optional type="date" min={f.startDate} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} error={fieldErr('endDate', 'schedule.endDate')} hint="Inclusivo" />
      </div>
      <SelectField label="Fuso da programação" required value={f.timezone} onChange={(e) => set('timezone', e.target.value)} error={fieldErr('timezone', 'schedule.timezone')}>
        {!zones.includes(f.timezone) && <option value={f.timezone}>{f.timezone}</option>}
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </SelectField>
      <Checkbox
        label="Lembrete ativado"
        description="Lembretes dentro do app; notificações push dependem da permissão deste dispositivo."
        checked={f.reminderEnabled}
        onChange={(e) => set('reminderEnabled', e.target.checked)}
      />

      {willRevise && (
        <p role="note" className="rounded-field bg-wash-sun px-3.5 py-2.5 text-sm text-[#443b00]">
          A nova dose ou programação vale a partir de agora; o histórico é preservado.
        </p>
      )}
      {error && (
        <FormError>
          {error.kind === 'offline' ? 'Cadastro e edição de itens precisam de conexão com a internet.' : error.kind === 'validation' ? 'Confira os campos destacados.' : error.message}
          {error.kind === 'conflict' && <ConflictActions onReload={onConflict} />}
        </FormError>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button type="submit" variant="primary" size="lg" pending={pending}>
          {item ? 'Salvar alterações' : 'Adicionar item'}
        </Button>
      </div>
    </form>
  );
}
