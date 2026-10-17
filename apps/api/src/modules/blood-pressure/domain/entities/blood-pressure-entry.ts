import { ConfirmationRequiredError, ValidationError } from '../../../../shared/domain/errors.js';
import { assertNotFuture, assertTimeZone, normalizeNotes } from '../../../../shared/domain/measurement-rules.js';

/** A blood-pressure reading. No clinical classification is ever derived from it. */
export interface BloodPressureEntry {
  id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  systolic: number;
  diastolic: number;
  /** null when not informed (never zero) */
  pulseBpm: number | null;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function positiveInt(v: number, field: string): number {
  if (!Number.isInteger(v) || v <= 0) throw new ValidationError('Valor inválido', { [field]: ['Use um número inteiro positivo'] });
  return v;
}

/**
 * Diastolic >= systolic is unusual (often a typing slip) → ask the user to double-check.
 * It is allowed with explicit confirmation; no diagnosis is implied.
 */
export function assertPlausibleOrConfirmed(systolic: number, diastolic: number, confirmedUnusual: boolean | undefined): void {
  if (diastolic >= systolic && !confirmedUnusual) {
    throw new ConfirmationRequiredError('A diastólica está igual ou maior que a sistólica. Confira os valores antes de salvar.', {
      diastolic: ['Confira: a diastólica costuma ser menor que a sistólica'],
    });
  }
}

export function createBloodPressureEntry(
  input: { id: string; userId: string; measuredAt: Date; timezone: string; systolic: number; diastolic: number; pulseBpm: number | null; notes?: string | null | undefined; confirmedUnusual?: boolean | undefined },
  now: Date,
): BloodPressureEntry {
  assertNotFuture(input.measuredAt, now);
  assertTimeZone(input.timezone);
  const systolic = positiveInt(input.systolic, 'systolic');
  const diastolic = positiveInt(input.diastolic, 'diastolic');
  const pulseBpm = input.pulseBpm === null ? null : positiveInt(input.pulseBpm, 'pulseBpm');
  assertPlausibleOrConfirmed(systolic, diastolic, input.confirmedUnusual);
  return {
    id: input.id,
    userId: input.userId,
    measuredAt: input.measuredAt,
    timezone: input.timezone,
    systolic,
    diastolic,
    pulseBpm,
    notes: normalizeNotes(input.notes),
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function changeBloodPressureEntry(
  e: BloodPressureEntry,
  c: { measuredAt?: Date | undefined; timezone?: string | undefined; systolic?: number | undefined; diastolic?: number | undefined; pulseBpm?: number | null | undefined; notes?: string | null | undefined; confirmedUnusual?: boolean | undefined },
  now: Date,
): BloodPressureEntry {
  const next: BloodPressureEntry = { ...e, version: e.version + 1, updatedAt: now };
  if (c.measuredAt !== undefined) {
    assertNotFuture(c.measuredAt, now);
    next.measuredAt = c.measuredAt;
  }
  if (c.timezone !== undefined) {
    assertTimeZone(c.timezone);
    next.timezone = c.timezone;
  }
  if (c.systolic !== undefined) next.systolic = positiveInt(c.systolic, 'systolic');
  if (c.diastolic !== undefined) next.diastolic = positiveInt(c.diastolic, 'diastolic');
  if (c.pulseBpm !== undefined) next.pulseBpm = c.pulseBpm === null ? null : positiveInt(c.pulseBpm, 'pulseBpm');
  if (c.notes !== undefined) next.notes = normalizeNotes(c.notes);
  if (c.systolic !== undefined || c.diastolic !== undefined) assertPlausibleOrConfirmed(next.systolic, next.diastolic, c.confirmedUnusual);
  return next;
}

export function deleteBloodPressureEntry(e: BloodPressureEntry, now: Date): BloodPressureEntry {
  return { ...e, version: e.version + 1, updatedAt: now, deletedAt: now };
}
