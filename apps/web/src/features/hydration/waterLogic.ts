import { addDays, zonedToUtc } from '@/shared/lib/time';

export const WATER_MAX_ML = 10000;

/** Water amount: positive integer ml only (no decimals, no units typed). */
export function parseWaterMl(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  const t = raw.trim().replace(/\s+/g, '');
  if (t === '') return { ok: false, error: 'Informe a quantidade em ml' };
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Use um número inteiro de ml (sem vírgula)' };
  const n = Number(t);
  if (n <= 0) return { ok: false, error: 'A quantidade deve ser maior que zero' };
  if (n > WATER_MAX_ML) return { ok: false, error: 'Confira a quantidade: no máximo 10.000 ml por registro' };
  return { ok: true, value: n };
}

/** [from, to) instants of a local date in tz — used to list the entries of one day. */
export function dayBounds(date: string, tz: string): { from: string; to: string } {
  return { from: zonedToUtc(date, '00:00', tz).toISOString(), to: zonedToUtc(addDays(date, 1), '00:00', tz).toISOString() };
}

/** Inclusive local-date range ending at `today` with `days` days. */
export function lastDays(today: string, days: number): { from: string; to: string } {
  return { from: addDays(today, -(days - 1)), to: today };
}
