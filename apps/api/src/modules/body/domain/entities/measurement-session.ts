import { ValidationError } from '../../../../shared/domain/errors.js';
import { assertNotFuture, assertTimeZone, normalizeNotes } from '../../../../shared/domain/measurement-rules.js';
import { positiveDecimal } from '../value-objects/decimal.js';

export const MEASUREMENT_TYPES = ['waist', 'abdomen', 'hip', 'chest', 'arm', 'thigh'] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];
export const SIDES = ['left', 'right', 'unspecified'] as const;
export type Side = (typeof SIDES)[number];
/** Only arm and thigh may be measured per side. */
export const SIDED_TYPES: readonly MeasurementType[] = ['arm', 'thigh'];

export interface MeasurementValue {
  type: MeasurementType;
  side: Side;
  valueCm: string;
}

export interface MeasurementSession {
  id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  notes: string | null;
  /** only the measurements actually taken — absent types are simply not present (never zero) */
  values: MeasurementValue[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export function validateValues(values: { type: string; side: string; valueCm: string }[]): MeasurementValue[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ValidationError('Informe pelo menos uma medida', { values: ['Informe pelo menos uma medida'] });
  }
  const seen = new Set<string>();
  const fieldErrors: Record<string, string[]> = {};
  const out: MeasurementValue[] = [];
  values.forEach((v, i) => {
    if (!MEASUREMENT_TYPES.includes(v.type as MeasurementType)) {
      (fieldErrors[`values.${i}.type`] ??= []).push('Tipo de medida inválido');
      return;
    }
    if (!SIDES.includes(v.side as Side)) {
      (fieldErrors[`values.${i}.side`] ??= []).push('Lado inválido');
      return;
    }
    const type = v.type as MeasurementType;
    const side = v.side as Side;
    if (!SIDED_TYPES.includes(type) && side !== 'unspecified') {
      (fieldErrors[`values.${i}.side`] ??= []).push('Este tipo de medida não tem lado');
    }
    const key = `${type}:${side}`;
    if (seen.has(key)) (fieldErrors[`values.${i}`] ??= []).push('Medida repetida (mesmo tipo e lado)');
    seen.add(key);
    try {
      out.push({ type, side, valueCm: positiveDecimal(v.valueCm, 2, `values.${i}.valueCm`) });
    } catch (e) {
      if (e instanceof ValidationError) Object.assign(fieldErrors, e.fieldErrors);
      else throw e;
    }
  });
  if (Object.keys(fieldErrors).length) throw new ValidationError('Confira as medidas', fieldErrors);
  return out;
}

export function createMeasurementSession(
  input: { id: string; userId: string; measuredAt: Date; timezone: string; notes?: string | null | undefined; values: { type: string; side: string; valueCm: string }[] },
  now: Date,
): MeasurementSession {
  assertNotFuture(input.measuredAt, now);
  assertTimeZone(input.timezone);
  return {
    id: input.id,
    userId: input.userId,
    measuredAt: input.measuredAt,
    timezone: input.timezone,
    notes: normalizeNotes(input.notes),
    values: validateValues(input.values),
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function changeMeasurementSession(
  s: MeasurementSession,
  c: { measuredAt?: Date | undefined; timezone?: string | undefined; notes?: string | null | undefined; values?: { type: string; side: string; valueCm: string }[] | undefined },
  now: Date,
): MeasurementSession {
  const next: MeasurementSession = { ...s, version: s.version + 1, updatedAt: now };
  if (c.measuredAt !== undefined) {
    assertNotFuture(c.measuredAt, now);
    next.measuredAt = c.measuredAt;
  }
  if (c.timezone !== undefined) {
    assertTimeZone(c.timezone);
    next.timezone = c.timezone;
  }
  if (c.notes !== undefined) next.notes = normalizeNotes(c.notes);
  if (c.values !== undefined) next.values = validateValues(c.values);
  return next;
}

export function deleteMeasurementSession(s: MeasurementSession, now: Date): MeasurementSession {
  return { ...s, version: s.version + 1, updatedAt: now, deletedAt: now };
}

/** Value of the same type AND side only (never compares waist with abdomen, or left with right). */
export function valueOf(s: MeasurementSession, type: MeasurementType, side: Side): string | undefined {
  return s.values.find((v) => v.type === type && v.side === side)?.valueCm;
}
