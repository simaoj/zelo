/** Rules shared by every timestamped health record (spec §6). Pure TS. */
import { ValidationError } from './errors.js';

/** Tolerance for small client/server clock skew when rejecting future instants. */
export const FUTURE_SKEW_MS = 60_000;

export function assertNotFuture(at: Date, now: Date, field = 'measuredAt'): void {
  if (Number.isNaN(at.getTime())) throw new ValidationError('Data inválida', { [field]: ['Data inválida'] });
  if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) {
    throw new ValidationError('A data não pode estar no futuro', { [field]: ['A data e o horário não podem estar no futuro'] });
  }
}

export function assertTimeZone(tz: string, field = 'timezone'): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new ValidationError('Fuso inválido', { [field]: ['Fuso horário inválido'] });
  }
}

export function normalizeNotes(notes: string | null | undefined, field = 'notes'): string | null {
  if (notes === undefined || notes === null) return null;
  if (notes.length > 1000) throw new ValidationError('Observação muito longa', { [field]: ['Use até 1000 caracteres'] });
  const t = notes.trim();
  return t.length ? t : null;
}
