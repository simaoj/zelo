import { ValidationError } from '../../../../shared/domain/errors.js';

/**
 * Exact decimal arithmetic on canonical strings (no floating point): "82.35" stays "82.35".
 */
const PLAIN = /^-?\d+(\.\d+)?$/;

export function canonical(value: string): string {
  if (!PLAIN.test(value)) throw new Error(`invalid decimal ${value}`);
  const neg = value.startsWith('-');
  const [i = '0', f = ''] = (neg ? value.slice(1) : value).split('.');
  const int = i.replace(/^0+(?=\d)/, '');
  const frac = f.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return out === '0' ? '0' : (neg ? '-' : '') + out;
}

function toScaled(value: string, scale: number): bigint {
  const neg = value.startsWith('-');
  const [i = '0', f = ''] = (neg ? value.slice(1) : value).split('.');
  const n = BigInt(i + f.padEnd(scale, '0'));
  return neg ? -n : n;
}

function scaleOf(v: string): number {
  return v.split('.')[1]?.length ?? 0;
}

function fromScaled(n: bigint, scale: number): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return canonical((neg ? '-' : '') + out);
}

/** a - b, exact. */
export function subtract(a: string, b: string): string {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  return fromScaled(toScaled(a, scale) - toScaled(b, scale), scale);
}

export function compare(a: string, b: string): number {
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const d = toScaled(a, scale) - toScaled(b, scale);
  return d === 0n ? 0 : d < 0n ? -1 : 1;
}

/** Validates a positive decimal quantity with up to `maxScale` fraction digits; returns canonical form. */
export function positiveDecimal(value: string, maxScale: number, field: string): string {
  const v = value.trim().replace(',', '.');
  if (!/^\d{1,6}(\.\d+)?$/.test(v) || scaleOf(v) > maxScale) {
    throw new ValidationError('Valor inválido', { [field]: [`Use um número positivo com até ${maxScale} casas decimais`] });
  }
  const c = canonical(v);
  if (compare(c, '0') <= 0) throw new ValidationError('Valor inválido', { [field]: ['O valor deve ser positivo'] });
  return c;
}
