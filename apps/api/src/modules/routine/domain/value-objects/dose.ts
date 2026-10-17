import { ValidationError } from '../../../../shared/domain/errors.js';

const DOSE_RE = /^\d{1,6}(\.\d{1,3})?$/;

/**
 * Canonical positive decimal with up to 3 fractional digits ("1.50" → "1.5", "007" → "7").
 * Accepts a comma as decimal separator for robustness; the API contract already normalizes.
 */
export function canonicalDose(raw: string, field = 'dose'): string {
  const v = raw.trim().replace(',', '.');
  if (!DOSE_RE.test(v) || Number(v) <= 0) {
    throw new ValidationError('Dose inválida', { [field]: ['Informe uma dose positiva com até 3 casas decimais'] });
  }
  let [int, frac = ''] = v.split('.') as [string, string?];
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

export function canonicalUnit(raw: string): string {
  const u = raw.trim();
  if (u.length === 0) throw new ValidationError('Unidade obrigatória', { unit: ['Unidade obrigatória'] });
  if (u.length > 30) throw new ValidationError('Unidade muito longa', { unit: ['Use até 30 caracteres'] });
  return u;
}
