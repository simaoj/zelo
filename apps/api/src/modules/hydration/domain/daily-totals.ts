import { ValidationError } from '../../../shared/domain/errors.js';
import { datesBetween, localDateOf, spanDays } from './local-date.js';
import type { WaterEntry } from './water-entry.js';

export const MAX_SUMMARY_DAYS = 400;

export interface DayTotal {
  date: string;
  /** null = no records that day (never 0 for absence) */
  totalMl: number | null;
  entryCount: number;
}

export function assertSummaryRange(from: string, to: string): void {
  const span = spanDays(from, to);
  if (span < 1) throw new ValidationError('Período inválido', { to: ['A data final deve ser igual ou posterior à inicial'] });
  if (span > MAX_SUMMARY_DAYS) throw new ValidationError('Período muito longo', { to: [`Use no máximo ${MAX_SUMMARY_DAYS} dias`] });
}

/** One row per local date in [from, to], grouping live entries by their local date in `tz`. */
export function dailyTotals(entries: Pick<WaterEntry, 'consumedAt' | 'amountMl' | 'deletedAt'>[], from: string, to: string, tz: string): DayTotal[] {
  const byDate = new Map<string, { total: number; count: number }>();
  for (const e of entries) {
    if (e.deletedAt) continue;
    const date = localDateOf(e.consumedAt, tz);
    const acc = byDate.get(date) ?? { total: 0, count: 0 };
    acc.total += e.amountMl;
    acc.count += 1;
    byDate.set(date, acc);
  }
  return datesBetween(from, to).map((date) => {
    const acc = byDate.get(date);
    return acc ? { date, totalMl: acc.total, entryCount: acc.count } : { date, totalMl: null, entryCount: 0 };
  });
}

/** Rounded average over days WITH records only; null if none. */
export function averageOnRecordedDays(days: DayTotal[]): number | null {
  const recorded = days.filter((d) => d.totalMl !== null);
  if (!recorded.length) return null;
  return Math.round(recorded.reduce((s, d) => s + d.totalMl!, 0) / recorded.length);
}
