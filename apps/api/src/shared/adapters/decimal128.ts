import { Decimal128 } from 'mongodb';

/** Canonical decimal string: no exponent, no trailing fractional zeros ("82.30" → "82.3", "80.00" → "80"). */
export function canonicalDecimal(value: string): string {
  let v = value.trim();
  let sign = '';
  if (v.startsWith('-')) {
    sign = '-';
    v = v.slice(1);
  } else if (v.startsWith('+')) v = v.slice(1);
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`Not a plain decimal: ${value}`);
  let [int = '0', frac = ''] = v.split('.');
  int = int.replace(/^0+(?=\d)/, '');
  frac = frac.replace(/0+$/, '');
  const out = frac ? `${int}.${frac}` : int;
  return out === '0' ? '0' : sign + out;
}

export function toDecimal128(value: string): Decimal128 {
  return Decimal128.fromString(canonicalDecimal(value));
}

export function fromDecimal128(value: Decimal128 | string | number): string {
  if (typeof value === 'number') return canonicalDecimal(String(value));
  if (typeof value === 'string') return canonicalDecimal(value);
  const s = value.toString();
  if (/e/i.test(s)) {
    // Decimal128 may print exponent form for some values; expand it.
    const m = /^(-?)(\d+)(?:\.(\d+))?E([+-]\d+)$/i.exec(s);
    if (!m) throw new Error(`Unsupported Decimal128 ${s}`);
    const [, sign = '', i = '', f = '', e = '0'] = m;
    const digits = i + f;
    const point = i.length + Number(e);
    const padded = point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
    return canonicalDecimal(sign + padded);
  }
  return canonicalDecimal(s);
}
