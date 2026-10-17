/**
 * Pure timezone helpers built on `Intl` (no external deps).
 *
 * Wall-clock → instant resolution follows spec §6:
 *  - DST gap (wall time does not exist): the FIRST VALID INSTANT AFTER the gap, i.e. the
 *    transition instant itself (America/New_York 2026-03-08 02:30 → 03:00 EDT = 07:00Z).
 *  - DST overlap (wall time happens twice): the FIRST instant (the earlier offset)
 *    (America/New_York 2026-11-01 01:30 → 01:30 EDT = 05:30Z), so only one occurrence exists.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(ms: number, tz: string): WallParts {
  const out: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year!,
    month: out.month!,
    day: out.day!,
    hour: out.hour! === 24 ? 0 : out.hour!,
    minute: out.minute!,
    second: out.second!,
  };
}

/** UTC offset (ms) of `tz` at instant `ms` (wall = utc + offset). */
export function offsetAt(ms: number, tz: string): number {
  const p = wallParts(ms, tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function parseLocalDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function dateToUtcMidnight(date: string): number {
  const { y, m, d } = parseLocalDate(date);
  return Date.UTC(y, m - 1, d);
}

function utcMidnightToDate(ms: number): string {
  const dt = new Date(ms);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function addDays(date: string, n: number): string {
  return utcMidnightToDate(dateToUtcMidnight(date) + n * DAY);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
  return new Date(dateToUtcMidnight(date)).getUTCDay();
}

/** Inclusive list of dates from..to. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Wall clock of an instant in `tz`. */
export function toLocal(instant: Date, tz: string): { date: string; time: string } {
  const p = wallParts(instant.getTime(), tz);
  return { date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function localDateOf(instant: Date, tz: string): string {
  return toLocal(instant, tz).date;
}

/**
 * Resolves a local date + HH:mm in an IANA zone to a UTC instant (see header for DST rules).
 * Assumes at most one offset transition within ±1 day, true for every real zone.
 */
export function resolveLocal(date: string, time: string, tz: string): Date {
  const [hh, mm] = time.split(':').map(Number);
  const { y, m, d } = parseLocalDate(date);
  const wall = Date.UTC(y, m - 1, d, hh!, mm!);
  const before = offsetAt(wall - DAY, tz);
  const after = offsetAt(wall + DAY, tz);
  const candidates = [...new Set([before, after])]
    .map((o) => wall - o)
    .filter((t) => offsetAt(t, tz) === wall - t)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]!);

  // Gap: wall time skipped. The transition lies between wall-after and wall-before
  // (after > before when clocks move forward). Binary-search the first instant with the new offset.
  let lo = Math.min(wall - after, wall - before);
  let hi = Math.max(wall - after, wall - before);
  if (offsetAt(lo, tz) === after) return new Date(lo);
  while (hi - lo > MINUTE) {
    const mid = lo + Math.max(1, Math.floor((hi - lo) / 2 / MINUTE)) * MINUTE;
    if (offsetAt(mid, tz) === after) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

/** First instant of local `date` in `tz` (handles zones whose midnight is skipped). */
export function startOfLocalDay(date: string, tz: string): Date {
  return resolveLocal(date, '00:00', tz);
}

/** [start, end) instants covering local `date` in `tz`. */
export function localDayRange(date: string, tz: string): { from: Date; to: Date } {
  return { from: startOfLocalDay(date, tz), to: startOfLocalDay(addDays(date, 1), tz) };
}
