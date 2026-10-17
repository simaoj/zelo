import { describe, expect, it } from 'vitest';
import { addDays, describeInstant, localDateOf, periodStart, todayIn, zonedToUtc } from '../time';

describe('period computation', () => {
  const now = new Date('2026-10-17T15:00:00Z'); // 12:00 in São Paulo
  it('7 days = today + 6 previous days at local midnight', () => {
    expect(periodStart('7d', 'America/Sao_Paulo', now)).toBe('2026-10-11T03:00:00.000Z');
  });
  it('30 and 90 days', () => {
    expect(periodStart('30d', 'America/Sao_Paulo', now)).toBe('2026-09-18T03:00:00.000Z');
    expect(periodStart('90d', 'UTC', now)).toBe('2026-07-20T00:00:00.000Z');
  });
  it('all has no lower bound', () => {
    expect(periodStart('all', 'UTC', now)).toBeUndefined();
  });
  it('uses the profile timezone for "today"', () => {
    const lateUtc = new Date('2026-10-18T01:30:00Z');
    expect(todayIn('America/Sao_Paulo', lateUtc)).toBe('2026-10-17');
    expect(todayIn('Asia/Tokyo', lateUtc)).toBe('2026-10-18');
  });
});

describe('zoned conversion', () => {
  it('converts local wall time to UTC', () => {
    expect(zonedToUtc('2026-10-17', '08:15', 'America/Sao_Paulo').toISOString()).toBe('2026-10-17T11:15:00.000Z');
    expect(zonedToUtc('2026-07-01', '08:00', 'Europe/Lisbon').toISOString()).toBe('2026-07-01T07:00:00.000Z');
  });
  it('advances nonexistent DST times to a valid instant', () => {
    // 2026-03-29 01:30 does not exist in Lisbon (clocks jump 01:00 → 02:00)
    const d = zonedToUtc('2026-03-29', '01:30', 'Europe/Lisbon');
    expect(localDateOf(d, 'Europe/Lisbon')).toBe('2026-03-29');
    expect(d.toISOString() >= '2026-03-29T01:00:00.000Z').toBe(true);
  });
  it('addDays crosses months', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });
});

describe('describeInstant', () => {
  const now = new Date('2026-10-17T15:00:00Z');
  const tz = 'America/Sao_Paulo';
  it('labels old records explicitly', () => {
    expect(describeInstant('2026-10-17T11:15:00Z', tz, now)).toBe('Hoje às 08:15');
    expect(describeInstant('2026-10-16T23:10:00Z', tz, now)).toBe('Ontem às 20:10');
    expect(describeInstant('2026-10-12T11:00:00Z', tz, now)).toBe('Registrado em 12/10 às 08:00');
  });
});
