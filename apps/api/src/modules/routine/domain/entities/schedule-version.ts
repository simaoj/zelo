import { ValidationError } from '../../../../shared/domain/errors.js';
import { canonicalDose, canonicalUnit } from '../value-objects/dose.js';
import { datesBetween, isValidTimeZone, localDateOf, resolveLocal, startOfLocalDay, weekdayOf } from '../value-objects/local-time.js';

export type Frequency = 'daily' | 'weekly' | 'none';

export interface ScheduleSpec {
  frequency: Frequency;
  /** 0 = Sunday … 6 = Saturday (weekly only) */
  weekdays: number[];
  /** unique HH:mm, sorted */
  times: string[];
  timezone: string;
  startDate: string;
  /** inclusive */
  endDate: string | null;
  reminderEnabled: boolean;
}

export interface ScheduleVersion extends ScheduleSpec {
  id: string;
  userId: string;
  itemId: string;
  /** confirmation instant (spec §6: "vigência a partir da confirmação") */
  effectiveFrom: Date;
  /** set when superseded by a revision or when the item is archived (exclusive) */
  effectiveUntil: Date | null;
  /**
   * Lower bound for generated occurrences (inclusive).
   *  - first version of an item: start of the local day (schedule tz) of `effectiveFrom`, so doses
   *    earlier today can still be confirmed, but no past days are back-filled;
   *  - revisions: exactly `effectiveFrom`, so the past (owned by the previous version) is untouched.
   */
  coverageFrom: Date;
  doseSnapshot: string;
  unitSnapshot: string;
  createdAt: Date;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
}

export function validateScheduleSpec(input: ScheduleSpec): ScheduleSpec {
  const errors: Record<string, string[]> = {};
  const add = (k: string, m: string) => (errors[k] ??= []).push(m);

  if (!['daily', 'weekly', 'none'].includes(input.frequency)) add('schedule.frequency', 'Frequência inválida');
  if (!isValidTimeZone(input.timezone)) add('schedule.timezone', 'Fuso horário inválido');
  if (!isRealDate(input.startDate)) add('schedule.startDate', 'Data inválida');
  if (input.endDate !== null && !isRealDate(input.endDate)) add('schedule.endDate', 'Data inválida');
  if (input.endDate !== null && isRealDate(input.startDate) && input.endDate < input.startDate) {
    add('schedule.endDate', 'O término não pode ser anterior ao início');
  }
  for (const t of input.times) if (!TIME_RE.test(t)) add('schedule.times', `Horário inválido: ${t}`);
  if (new Set(input.times).size !== input.times.length) add('schedule.times', 'Horários repetidos');
  for (const w of input.weekdays) if (!Number.isInteger(w) || w < 0 || w > 6) add('schedule.weekdays', 'Dia inválido');

  const frequency = input.frequency;
  if (frequency !== 'none' && input.times.length === 0) add('schedule.times', 'Informe ao menos um horário');
  if (frequency === 'weekly' && input.weekdays.length === 0) add('schedule.weekdays', 'Escolha ao menos um dia');

  if (Object.keys(errors).length > 0) throw new ValidationError('Programação inválida', errors);

  return {
    frequency,
    weekdays: frequency === 'weekly' ? [...new Set(input.weekdays)].sort((a, b) => a - b) : [],
    times: frequency === 'none' ? [] : [...input.times].sort(),
    timezone: input.timezone,
    startDate: input.startDate,
    endDate: input.endDate,
    reminderEnabled: frequency === 'none' ? false : input.reminderEnabled,
  };
}

export function createScheduleVersion(input: {
  id: string;
  userId: string;
  itemId: string;
  spec: ScheduleSpec;
  dose: string;
  unit: string;
  now: Date;
  isFirst: boolean;
}): ScheduleVersion {
  const spec = validateScheduleSpec(input.spec);
  return {
    ...spec,
    id: input.id,
    userId: input.userId,
    itemId: input.itemId,
    effectiveFrom: input.now,
    effectiveUntil: null,
    coverageFrom: input.isFirst ? startOfLocalDay(localDateOf(input.now, spec.timezone), spec.timezone) : input.now,
    doseSnapshot: canonicalDose(input.dose),
    unitSnapshot: canonicalUnit(input.unit),
    createdAt: input.now,
  };
}

export interface PlannedSlot {
  localDate: string;
  localTime: string;
  scheduledAt: Date;
}

/**
 * Slots of `version` whose local date (schedule tz) is within [fromDate, toDate] and whose
 * instant is within the version's validity [coverageFrom, effectiveUntil).
 * Deterministic: the same inputs always yield the same (scheduleVersionId, localDate, localTime) keys.
 */
export function planSlots(version: ScheduleVersion, fromDate: string, toDate: string): PlannedSlot[] {
  if (version.frequency === 'none' || version.times.length === 0) return [];
  const from = fromDate > version.startDate ? fromDate : version.startDate;
  const to = version.endDate !== null && version.endDate < toDate ? version.endDate : toDate;
  if (from > to) return [];
  const slots: PlannedSlot[] = [];
  for (const date of datesBetween(from, to)) {
    if (version.frequency === 'weekly' && !version.weekdays.includes(weekdayOf(date))) continue;
    for (const time of version.times) {
      const scheduledAt = resolveLocal(date, time, version.timezone);
      if (scheduledAt < version.coverageFrom) continue;
      if (version.effectiveUntil && scheduledAt >= version.effectiveUntil) continue;
      slots.push({ localDate: date, localTime: time, scheduledAt });
    }
  }
  return slots;
}
