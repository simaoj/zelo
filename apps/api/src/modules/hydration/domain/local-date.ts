/** Local-calendar helpers for daily grouping in an IANA timezone (pure; luxon has no I/O). */
import { DateTime } from 'luxon';

/** Local date (YYYY-MM-DD) of `instant` in `tz`. */
export function localDateOf(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toISODate()!;
}

/** First instant of local `date` in `tz` (zones that skip midnight start at the first valid instant). */
export function startOfLocalDay(date: string, tz: string): Date {
  return DateTime.fromISO(date, { zone: tz }).startOf('day').toJSDate();
}

/** [from, to) instants covering the local dates `fromDate`..`toDate` (inclusive) in `tz`. */
export function localRange(fromDate: string, toDate: string, tz: string): { from: Date; to: Date } {
  return { from: startOfLocalDay(fromDate, tz), to: startOfLocalDay(addDays(toDate, 1), tz) };
}

export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days: n }).toISODate()!;
}

/** Number of calendar days in the inclusive span from..to (1 when equal; ≤0 when from > to). */
export function spanDays(from: string, to: string): number {
  return Math.round(DateTime.fromISO(to, { zone: 'UTC' }).diff(DateTime.fromISO(from, { zone: 'UTC' }), 'days').days) + 1;
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
