import type { Frequency, RoutineItem, RoutineType, ScheduleInput, ScheduleVersion } from '@zelo/contracts';
import { normalizeDecimal } from '@/shared/lib/decimal';
import { WEEKDAY_SHORT } from '@/shared/lib/time';

export interface ItemFormState {
  name: string;
  type: RoutineType;
  dose: string;
  unit: string;
  instructions: string;
  startDate: string;
  endDate: string;
  timezone: string;
  frequency: Frequency;
  weekdays: number[];
  times: string[];
  reminderEnabled: boolean;
}

export type ItemErrors = Partial<Record<keyof ItemFormState, string>>;

export interface ItemPayload {
  name: string;
  type: RoutineType;
  dose: string;
  unit: string;
  instructions: string | null;
  schedule: ScheduleInput;
}

export function emptyItemForm(today: string, tz: string): ItemFormState {
  return {
    name: '',
    type: 'medication',
    dose: '',
    unit: '',
    instructions: '',
    startDate: today,
    endDate: '',
    timezone: tz,
    frequency: 'daily',
    weekdays: [],
    times: ['08:00'],
    reminderEnabled: true,
  };
}

export function itemToForm(item: RoutineItem, today: string, tz: string): ItemFormState {
  const s = item.currentSchedule;
  return {
    name: item.name,
    type: item.type,
    dose: item.currentDose.replace('.', ','),
    unit: item.currentUnit,
    instructions: item.instructions ?? '',
    startDate: s?.startDate ?? today,
    endDate: s?.endDate ?? '',
    timezone: s?.timezone ?? tz,
    frequency: s?.frequency ?? 'none',
    weekdays: s?.weekdays ?? [],
    times: s?.times.length ? [...s.times] : s?.frequency === 'none' ? [] : ['08:00'],
    reminderEnabled: s?.reminderEnabled ?? true,
  };
}

/** Client validation mirroring the contracts (server is the authority). */
export function buildItemPayload(f: ItemFormState): { ok: true; value: ItemPayload } | { ok: false; errors: ItemErrors } {
  const errors: ItemErrors = {};
  const name = f.name.trim();
  if (!name) errors.name = 'Informe o nome';
  else if (name.length > 120) errors.name = 'Use até 120 caracteres';
  const dose = normalizeDecimal(f.dose, 3);
  if (!dose.ok) errors.dose = dose.error;
  const unit = f.unit.trim();
  if (!unit) errors.unit = 'Informe a unidade';
  else if (unit.length > 30) errors.unit = 'Use até 30 caracteres';
  if (f.instructions.length > 1000) errors.instructions = 'Use até 1000 caracteres';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate)) errors.startDate = 'Informe o início';
  if (f.endDate && f.endDate < f.startDate) errors.endDate = 'O término não pode ser anterior ao início';
  if (!f.timezone) errors.timezone = 'Escolha o fuso';
  const times = f.frequency === 'none' ? [] : f.times.filter((t) => t !== '');
  if (f.frequency !== 'none') {
    if (times.length === 0) errors.times = 'Informe ao menos um horário';
    else if (new Set(times).size !== times.length) errors.times = 'Há horários repetidos';
    else if (times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) errors.times = 'Horário inválido';
  }
  if (f.frequency === 'weekly' && f.weekdays.length === 0) errors.weekdays = 'Escolha ao menos um dia';
  if (Object.keys(errors).length || !dose.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      type: f.type,
      dose: dose.value,
      unit,
      instructions: f.instructions.trim() === '' ? null : f.instructions.trim(),
      schedule: {
        frequency: f.frequency,
        weekdays: f.frequency === 'weekly' ? [...f.weekdays].sort() : [],
        times: [...times].sort(),
        timezone: f.timezone,
        startDate: f.startDate,
        endDate: f.endDate || null,
        reminderEnabled: f.reminderEnabled,
      },
    },
  };
}

/** True when the change must create a new schedule version (dose/unit/frequency/times/tz/dates/reminder). */
export function scheduleChanged(item: RoutineItem, p: ItemPayload): boolean {
  const s = item.currentSchedule;
  if (!s) return true;
  if (Number(p.dose) !== Number(item.currentDose) || p.unit !== item.currentUnit) return true;
  return (
    p.schedule.frequency !== s.frequency ||
    p.schedule.timezone !== s.timezone ||
    p.schedule.startDate !== s.startDate ||
    (p.schedule.endDate ?? null) !== (s.endDate ?? null) ||
    p.schedule.reminderEnabled !== s.reminderEnabled ||
    [...p.schedule.times].sort().join(',') !== [...s.times].sort().join(',') ||
    [...p.schedule.weekdays].sort().join(',') !== [...s.weekdays].sort().join(',')
  );
}

export function basicsChanged(item: RoutineItem, p: ItemPayload): boolean {
  return p.name !== item.name || p.type !== item.type || (p.instructions ?? null) !== (item.instructions ?? null);
}

export function describeSchedule(s: Pick<ScheduleVersion, 'frequency' | 'weekdays' | 'times'> | null): string {
  if (!s || s.frequency === 'none') return 'Sem programação (uso quando precisar)';
  const times = s.times.join(', ');
  if (s.frequency === 'daily') return `Todos os dias às ${times}`;
  const days = [...s.weekdays].sort().map((d) => WEEKDAY_SHORT[d]).join(', ');
  return `${days} às ${times}`;
}
