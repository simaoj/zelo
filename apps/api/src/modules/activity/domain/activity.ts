import { DateTime } from 'luxon';
import { ValidationError } from '../../../shared/domain/errors.js';

/** Only provider in this version: data pushed by the Health Auto Export iPhone app. */
export type ActivityProvider = 'health-auto-export';
export const HEALTH_AUTO_EXPORT: ActivityProvider = 'health-auto-export';

/** Consolidated daily step total, as received. Identity: (userId, provider, localDate). */
export interface DailySteps {
  id: string;
  userId: string;
  provider: ActivityProvider;
  /** YYYY-MM-DD taken from the export's own timestamp/offset (never re-derived) */
  localDate: string;
  count: number;
  offsetMinutes: number;
  /** last time Zelo received this total ("último recebimento") */
  receivedAt: Date;
  createdAt: Date;
}

/** Workout as received. Identity: (userId, provider, externalId = exported id). */
export interface Workout {
  id: string;
  userId: string;
  provider: ActivityProvider;
  externalId: string;
  name: string;
  startedAt: Date;
  endedAt: Date;
  startOffsetMinutes: number;
  localDate: string;
  /** as exported; never recomputed from start/end */
  durationSeconds: number;
  distanceMeters: number | null;
  /** activeEnergyBurned in kcal — never totalEnergy */
  activeEnergyKcal: number | null;
  receivedAt: Date;
  createdAt: Date;
}

/** Values of one received daily total (the payload part of DailySteps). */
export interface StepsValues {
  localDate: string;
  count: number;
  offsetMinutes: number;
}

/** Values of one received workout (the payload part of Workout). */
export interface WorkoutValues {
  externalId: string;
  name: string;
  startedAt: Date;
  endedAt: Date;
  startOffsetMinutes: number;
  localDate: string;
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKcal: number | null;
}

export function assertStepsValues(v: StepsValues): void {
  if (!Number.isInteger(v.count) || v.count < 0) throw new ValidationError('Passos inválidos', { count: ['Use um inteiro não negativo'] });
  assertLocalDate(v.localDate, 'localDate');
}

export function assertWorkoutValues(v: WorkoutValues): void {
  if (!v.externalId) throw new ValidationError('Exercício sem id', { id: ['Obrigatório'] });
  if (v.endedAt.getTime() < v.startedAt.getTime()) throw new ValidationError('Fim antes do início', { end: ['O fim não pode preceder o início'] });
  if (!Number.isFinite(v.durationSeconds) || v.durationSeconds < 0) throw new ValidationError('Duração inválida', { duration: ['Use segundos (número finito ≥ 0)'] });
  for (const [k, n] of [['distanceMeters', v.distanceMeters], ['activeEnergyKcal', v.activeEnergyKcal]] as const) {
    if (n !== null && (!Number.isFinite(n) || n < 0)) throw new ValidationError('Valor inválido', { [k]: ['Número finito ≥ 0'] });
  }
}

/** "unchanged" = every received value equals the stored one (receivedAt is not a value). */
export function sameSteps(a: StepsValues, b: StepsValues): boolean {
  return a.localDate === b.localDate && a.count === b.count && a.offsetMinutes === b.offsetMinutes;
}

export function sameWorkout(a: WorkoutValues, b: WorkoutValues): boolean {
  return (
    a.externalId === b.externalId &&
    a.name === b.name &&
    a.startedAt.getTime() === b.startedAt.getTime() &&
    a.endedAt.getTime() === b.endedAt.getTime() &&
    a.startOffsetMinutes === b.startOffsetMinutes &&
    a.localDate === b.localDate &&
    a.durationSeconds === b.durationSeconds &&
    a.distanceMeters === b.distanceMeters &&
    a.activeEnergyKcal === b.activeEnergyKcal
  );
}

// ---------- goal ----------

export const MAX_DAILY_STEPS_TARGET = 200_000;

/** Optional user-defined daily steps target. No automatic recommendation. */
export interface ActivityGoal {
  id: string;
  userId: string;
  dailyStepsTarget: number;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function assertTarget(t: number): number {
  if (!Number.isInteger(t) || t <= 0 || t > MAX_DAILY_STEPS_TARGET) {
    throw new ValidationError('Meta inválida', { dailyStepsTarget: [`Use um inteiro entre 1 e ${MAX_DAILY_STEPS_TARGET}`] });
  }
  return t;
}

export function createActivityGoal(input: { id: string; userId: string; dailyStepsTarget: number }, now: Date): ActivityGoal {
  return { id: input.id, userId: input.userId, dailyStepsTarget: assertTarget(input.dailyStepsTarget), active: true, version: 0, createdAt: now, updatedAt: now };
}

export function changeActivityGoal(g: ActivityGoal, dailyStepsTarget: number, now: Date): ActivityGoal {
  return { ...g, dailyStepsTarget: assertTarget(dailyStepsTarget), version: g.version + 1, updatedAt: now };
}

// ---------- local dates ----------

export const MAX_RANGE_DAYS = 400;

export function assertLocalDate(date: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date, { zone: 'utc' }).isValid) {
    throw new ValidationError('Data inválida', { [field]: ['Use o formato AAAA-MM-DD'] });
  }
}

export function localToday(now: Date, timezone: string): string {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate() ?? DateTime.fromJSDate(now, { zone: 'utc' }).toISODate()!;
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** Inclusive list of local dates; validates order and the max range. */
export function datesBetween(from: string, to: string): string[] {
  assertLocalDate(from, 'from');
  assertLocalDate(to, 'to');
  if (from > to) throw new ValidationError('Período inválido', { to: ['Deve ser igual ou posterior a from'] });
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > MAX_RANGE_DAYS) throw new ValidationError('Período muito longo', { to: [`Máximo de ${MAX_RANGE_DAYS} dias`] });
  }
  return out;
}
