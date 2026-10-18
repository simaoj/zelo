import { ValidationError } from '../../../shared/domain/errors.js';
import { assertNotFuture, assertTimeZone, normalizeNotes } from '../../../shared/domain/measurement-rules.js';

/** Upper bound is a typo guard (10 L in one entry), not a clinical limit. */
export const MAX_WATER_ML = 10_000;

export interface WaterEntry {
  id: string;
  userId: string;
  consumedAt: Date;
  /** device tz at registration (informational; daily grouping uses the profile tz) */
  timezone: string;
  amountMl: number;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface NewWaterEntryInput {
  id: string;
  userId: string;
  consumedAt: Date;
  timezone: string;
  amountMl: number;
  notes?: string | null | undefined;
}

export interface WaterEntryChanges {
  consumedAt?: Date | undefined;
  timezone?: string | undefined;
  amountMl?: number | undefined;
  notes?: string | null | undefined;
}

export function assertWaterMl(value: number, field = 'amountMl'): number {
  if (!Number.isInteger(value)) throw new ValidationError('Quantidade inválida', { [field]: ['Use um número inteiro de ml'] });
  if (value <= 0) throw new ValidationError('Quantidade inválida', { [field]: ['A quantidade deve ser positiva'] });
  if (value > MAX_WATER_ML) throw new ValidationError('Quantidade inválida', { [field]: [`Use até ${MAX_WATER_ML} ml`] });
  return value;
}

export function createWaterEntry(input: NewWaterEntryInput, now: Date): WaterEntry {
  assertNotFuture(input.consumedAt, now, 'consumedAt');
  assertTimeZone(input.timezone);
  return {
    id: input.id,
    userId: input.userId,
    consumedAt: input.consumedAt,
    timezone: input.timezone,
    amountMl: assertWaterMl(input.amountMl),
    notes: normalizeNotes(input.notes),
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function changeWaterEntry(e: WaterEntry, c: WaterEntryChanges, now: Date): WaterEntry {
  const next: WaterEntry = { ...e, version: e.version + 1, updatedAt: now };
  if (c.consumedAt !== undefined) {
    assertNotFuture(c.consumedAt, now, 'consumedAt');
    next.consumedAt = c.consumedAt;
  }
  if (c.timezone !== undefined) {
    assertTimeZone(c.timezone);
    next.timezone = c.timezone;
  }
  if (c.amountMl !== undefined) next.amountMl = assertWaterMl(c.amountMl);
  if (c.notes !== undefined) next.notes = normalizeNotes(c.notes);
  return next;
}

export function deleteWaterEntry(e: WaterEntry, now: Date): WaterEntry {
  return { ...e, version: e.version + 1, updatedAt: now, deletedAt: now };
}
