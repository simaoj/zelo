/**
 * Time-zone helpers built on Intl only (no external deps).
 * Instants are UTC ISO strings; local dates are YYYY-MM-DD; local times HH:mm.
 */
import type { Period } from '@zelo/contracts';

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = partsCache.get(tz);
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
    partsCache.set(tz, f);
  }
  return f;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClock(instant: Date | string | number, tz: string): WallClock {
  const d = instant instanceof Date ? instant : new Date(instant);
  const map: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return {
    year: map.year!,
    month: map.month!,
    day: map.day!,
    hour: map.hour === 24 ? 0 : map.hour!,
    minute: map.minute!,
    second: map.second!,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Offset (ms) of `tz` at `instant`: wallclock-as-UTC minus actual UTC. */
export function tzOffsetMs(instant: number, tz: string): number {
  const w = wallClock(instant, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Local date (YYYY-MM-DD) of an instant in tz. */
export function localDateOf(instant: Date | string | number, tz: string): string {
  const w = wallClock(instant, tz);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Local time (HH:mm) of an instant in tz. */
export function localTimeOf(instant: Date | string | number, tz: string): string {
  const w = wallClock(instant, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return localDateOf(now, tz);
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic, tz-independent). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/**
 * Convert a local wall-clock date+time in `tz` to a UTC instant.
 * Nonexistent times (DST gap) resolve forward to the first valid instant;
 * repeated times resolve to the first occurrence.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const target = Date.UTC(y!, mo! - 1, d!, h!, mi!, 0);
  // candidate instants using offsets around the target
  const o1 = tzOffsetMs(target, tz);
  const o2 = tzOffsetMs(target - o1, tz);
  const candidates = [target - o1, target - o2].sort((a, b) => a - b);
  for (const c of candidates) {
    if (formatKey(c, tz) === `${date} ${time}`) return new Date(c);
  }
  // DST gap: wall time doesn't exist → first valid instant after the gap
  const later = Math.max(...candidates);
  return new Date(later);
}

function formatKey(instant: number, tz: string) {
  return `${localDateOf(instant, tz)} ${localTimeOf(instant, tz)}`;
}

/** Inclusive start instant (ISO) of a period: today + N−1 previous days in tz. `all` → undefined. */
export function periodStart(period: Period, tz: string, now: Date = new Date()): string | undefined {
  if (period === 'all') return undefined;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const first = addDays(todayIn(tz, now), -(days - 1));
  return zonedToUtc(first, '00:00', tz).toISOString();
}

export const PERIOD_LABELS: Record<Period, string> = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', all: 'Tudo' };

// ---------- formatting (pt-BR) ----------

function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...opts });
}

/** "quinta-feira, 24 de outubro" for a local date. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const s = fmt('UTC', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "24/10" for a local date */
export function formatShortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/** "24/10/2026" */
export function formatFullDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** "24 de out." */
export function formatDayMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return fmt('UTC', { day: 'numeric', month: 'short' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/**
 * Human label of when a record happened, relative to today in `tz`.
 * Old records are never presented as today's: "Hoje às 08:15", "Ontem às 20:10", "Registrado em 12/10 às 08:00".
 */
export function describeInstant(instant: string, tz: string, now: Date = new Date()): string {
  const date = localDateOf(instant, tz);
  const time = localTimeOf(instant, tz);
  const today = todayIn(tz, now);
  if (date === today) return `Hoje às ${time}`;
  if (date === addDays(today, -1)) return `Ontem às ${time}`;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return `Registrado em ${sameYear ? formatShortDate(date) : formatFullDate(date)} às ${time}`;
}

/** "24/10 • 08:15" */
export function formatDateTime(instant: string, tz: string): string {
  return `${formatShortDate(localDateOf(instant, tz))} • ${localTimeOf(instant, tz)}`;
}

/** Greeting by local hour. */
export function greeting(tz: string, now: Date = new Date()): string {
  const h = wallClock(now, tz).hour;
  if (h < 5) return 'Boa noite';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function isFutureInstant(instant: Date, now: Date = new Date()): boolean {
  // one-minute tolerance for clock skew between input and submit
  return instant.getTime() > now.getTime() + 60_000;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

export function listTimeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Noronha', 'UTC'];
  }
}

export const WEEKDAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const WEEKDAY_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
