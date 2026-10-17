/**
 * Decimal helpers. The UI accepts comma decimals ("82,35"); the API contract uses
 * canonical dot decimal strings ("82.35"). Values are kept as strings end-to-end so
 * precision is never lost through floating point.
 */

export type DecimalResult = { ok: true; value: string } | { ok: false; error: string };

/** Normalize user input to a canonical decimal string, validating scale and positivity. */
export function normalizeDecimal(raw: string, maxScale = 2): DecimalResult {
  const trimmed = raw.trim().replace(/\s+/g, '');
  if (trimmed === '') return { ok: false, error: 'Informe um valor' };
  // allow a single comma or dot as decimal separator
  const unified = trimmed.replace(',', '.');
  if (!/^\d+(\.\d*)?$/.test(unified)) return { ok: false, error: 'Use apenas números (ex.: 82,35)' };
  const [rawInt = '', frac = ''] = unified.split('.');
  const intPart = (rawInt === '' ? '0' : rawInt).replace(/^0+(?=\d)/, '');
  if (frac.length > maxScale) return { ok: false, error: `Use até ${maxScale} casas decimais` };
  if (intPart.length > 6) return { ok: false, error: 'Valor muito grande' };
  const value = frac.length > 0 ? `${intPart}.${frac}` : intPart;
  if (!(Number(value) > 0)) return { ok: false, error: 'O valor deve ser maior que zero' };
  return { ok: true, value };
}

/** Parse a positive integer field (blood pressure, pulse). Empty → null. */
export function parsePositiveInt(raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Use um número inteiro' };
  const n = Number(t);
  if (n <= 0) return { ok: false, error: 'O valor deve ser maior que zero' };
  if (n > 999) return { ok: false, error: 'Valor muito grande' };
  return { ok: true, value: n };
}

/** "82.35" → "82,35" (pt-BR), keeping the exact digits. */
export function formatDecimal(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const [int = '0', frac] = abs.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '−' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/** Signed variation, e.g. "-0.3" → "−0,3", "0.2" → "+0,2", "0" → "0". */
export function formatDelta(value: string | null | undefined): string {
  if (value == null) return '—';
  if (Number(value) === 0) return '0';
  return value.startsWith('-') ? formatDecimal(value) : `+${formatDecimal(value)}`;
}

/** Decimal subtraction on strings with up to 3 decimals, avoiding float artifacts. */
export function subtractDecimal(a: string, b: string): string {
  const scale = 1000;
  const toInt = (s: string) => {
    const neg = s.startsWith('-');
    const [i = '0', f = ''] = (neg ? s.slice(1) : s).split('.');
    const n = Number(i) * scale + Number((f + '000').slice(0, 3));
    return neg ? -n : n;
  };
  const diff = toInt(a) - toInt(b);
  const neg = diff < 0;
  const abs = Math.abs(diff);
  const int = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/** Decimal string → number, only for plotting (never for storage). */
export function toNumber(value: string): number {
  return Number(value);
}
