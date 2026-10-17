import { parsePositiveInt } from '@/shared/lib/decimal';

export interface BpInput {
  systolic: string;
  diastolic: string;
  pulse: string;
}

export type BpParse =
  | { ok: true; systolic: number; diastolic: number; pulseBpm: number | null }
  | { ok: false; errors: Partial<Record<keyof BpInput, string>> };

/** Systolic and diastolic required positive ints; pulse optional (empty → null). */
export function parseBp(input: BpInput): BpParse {
  const errors: Partial<Record<keyof BpInput, string>> = {};
  const s = parsePositiveInt(input.systolic);
  const d = parsePositiveInt(input.diastolic);
  const p = parsePositiveInt(input.pulse);
  if (!s.ok) errors.systolic = s.error;
  else if (s.value === null) errors.systolic = 'Informe a sistólica';
  if (!d.ok) errors.diastolic = d.error;
  else if (d.value === null) errors.diastolic = 'Informe a diastólica';
  if (!p.ok) errors.pulse = p.error;
  if (Object.keys(errors).length || !s.ok || !d.ok || !p.ok) return { ok: false, errors };
  return { ok: true, systolic: s.value!, diastolic: d.value!, pulseBpm: p.value };
}

/** Diastolic ≥ systolic asks the user to double-check (no diagnosis). */
export function needsConfirmation(systolic: number, diastolic: number): boolean {
  return diastolic >= systolic;
}

export const BP_CONFIRM_TEXT =
  'A diastólica (mínima) ficou igual ou maior que a sistólica (máxima). Confira se os números foram digitados na ordem certa.';
