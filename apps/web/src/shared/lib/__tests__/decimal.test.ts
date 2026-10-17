import { describe, expect, it } from 'vitest';
import { formatDecimal, formatDelta, normalizeDecimal, parsePositiveInt, subtractDecimal } from '../decimal';

describe('normalizeDecimal', () => {
  it('accepts comma decimals and normalizes to dot', () => {
    expect(normalizeDecimal('82,35')).toEqual({ ok: true, value: '82.35' });
    expect(normalizeDecimal(' 82.3 ')).toEqual({ ok: true, value: '82.3' });
    expect(normalizeDecimal('082')).toEqual({ ok: true, value: '82' });
  });
  it('keeps exact digits (no float rounding)', () => {
    expect(normalizeDecimal('0,1')).toEqual({ ok: true, value: '0.1' });
    expect(normalizeDecimal('99999,99')).toEqual({ ok: true, value: '99999.99' });
  });
  it('rejects too many decimals, zero, negatives and garbage', () => {
    expect(normalizeDecimal('82,355').ok).toBe(false);
    expect(normalizeDecimal('0').ok).toBe(false);
    expect(normalizeDecimal('-1').ok).toBe(false);
    expect(normalizeDecimal('8a').ok).toBe(false);
    expect(normalizeDecimal('').ok).toBe(false);
    expect(normalizeDecimal('1,2,3').ok).toBe(false);
  });
  it('supports dose scale of 3', () => {
    expect(normalizeDecimal('0,125', 3)).toEqual({ ok: true, value: '0.125' });
  });
});

describe('formatting', () => {
  it('formats pt-BR', () => {
    expect(formatDecimal('82.35')).toBe('82,35');
    expect(formatDecimal('1234.5')).toBe('1.234,5');
    expect(formatDelta('-0.3')).toBe('−0,3');
    expect(formatDelta('0.2')).toBe('+0,2');
  });
  it('subtracts decimal strings exactly', () => {
    expect(subtractDecimal('82.35', '82.1')).toBe('0.25');
    expect(subtractDecimal('80', '80.5')).toBe('-0.5');
  });
  it('parses integers; empty pulse becomes null', () => {
    expect(parsePositiveInt('')).toEqual({ ok: true, value: null });
    expect(parsePositiveInt('72')).toEqual({ ok: true, value: 72 });
    expect(parsePositiveInt('7.2').ok).toBe(false);
    expect(parsePositiveInt('0').ok).toBe(false);
  });
});
