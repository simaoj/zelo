import { assertNotFuture, assertTimeZone, normalizeNotes } from '../../../../shared/domain/measurement-rules.js';
import { positiveDecimal, subtract } from '../value-objects/decimal.js';

export interface WeightEntry {
  id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  /** canonical decimal string, up to 2 fraction digits */
  weightKg: string;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface NewWeightInput {
  id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  weightKg: string;
  notes?: string | null | undefined;
}

export interface WeightChanges {
  measuredAt?: Date | undefined;
  timezone?: string | undefined;
  weightKg?: string | undefined;
  notes?: string | null | undefined;
}

export function createWeightEntry(input: NewWeightInput, now: Date): WeightEntry {
  assertNotFuture(input.measuredAt, now);
  assertTimeZone(input.timezone);
  return {
    id: input.id,
    userId: input.userId,
    measuredAt: input.measuredAt,
    timezone: input.timezone,
    weightKg: positiveDecimal(input.weightKg, 2, 'weightKg'),
    notes: normalizeNotes(input.notes),
    version: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

export function changeWeightEntry(e: WeightEntry, c: WeightChanges, now: Date): WeightEntry {
  const next: WeightEntry = { ...e, version: e.version + 1, updatedAt: now };
  if (c.measuredAt !== undefined) {
    assertNotFuture(c.measuredAt, now);
    next.measuredAt = c.measuredAt;
  }
  if (c.timezone !== undefined) {
    assertTimeZone(c.timezone);
    next.timezone = c.timezone;
  }
  if (c.weightKg !== undefined) next.weightKg = positiveDecimal(c.weightKg, 2, 'weightKg');
  if (c.notes !== undefined) next.notes = normalizeNotes(c.notes);
  return next;
}

export function deleteWeightEntry(e: WeightEntry, now: Date): WeightEntry {
  return { ...e, version: e.version + 1, updatedAt: now, deletedAt: now };
}

/** Chronological order: measuredAt asc, then id asc (stable tie-break for same instant). */
export function chronologicalCompare(a: Pick<WeightEntry, 'measuredAt' | 'id'>, b: Pick<WeightEntry, 'measuredAt' | 'id'>): number {
  const d = a.measuredAt.getTime() - b.measuredAt.getTime();
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Variation = this weight minus the chronologically previous (non-deleted) entry. */
export function weightDelta(current: Pick<WeightEntry, 'weightKg'>, previous: Pick<WeightEntry, 'weightKg'> | null): string | null {
  return previous ? subtract(current.weightKg, previous.weightKg) : null;
}

/** Computes deltas for a set of live entries (any order). Returns a map id → delta. */
export function deltasFor(entries: WeightEntry[]): Map<string, string | null> {
  const sorted = [...entries].filter((e) => !e.deletedAt).sort(chronologicalCompare);
  const out = new Map<string, string | null>();
  sorted.forEach((e, i) => out.set(e.id, weightDelta(e, i > 0 ? sorted[i - 1]! : null)));
  return out;
}
