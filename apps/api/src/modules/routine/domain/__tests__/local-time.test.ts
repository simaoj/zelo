import { describe, expect, it } from 'vitest';
import { addDays, localDayRange, resolveLocal, toLocal, weekdayOf } from '../value-objects/local-time.js';

const iso = (d: Date) => d.toISOString();

describe('resolveLocal', () => {
  it('resolves a regular wall time', () => {
    expect(iso(resolveLocal('2026-10-17', '08:00', 'America/Sao_Paulo'))).toBe('2026-10-17T11:00:00.000Z');
  });

  describe('DST gap → first valid instant after the gap', () => {
    it('America/New_York 02:30 on spring-forward → 03:00 EDT', () => {
      expect(iso(resolveLocal('2026-03-08', '02:30', 'America/New_York'))).toBe('2026-03-08T07:00:00.000Z');
      expect(toLocal(resolveLocal('2026-03-08', '02:30', 'America/New_York'), 'America/New_York').time).toBe('03:00');
    });
    it('America/Santiago midnight skipped → 01:00', () => {
      const t = resolveLocal('2026-09-06', '00:00', 'America/Santiago');
      expect(iso(t)).toBe('2026-09-06T04:00:00.000Z');
      expect(toLocal(t, 'America/Santiago')).toEqual({ date: '2026-09-06', time: '01:00' });
    });
    it('Europe/Lisbon 01:30 on spring-forward → 02:00 WEST', () => {
      expect(iso(resolveLocal('2026-03-29', '01:30', 'Europe/Lisbon'))).toBe('2026-03-29T01:00:00.000Z');
    });
  });

  describe('DST overlap → single, first instant', () => {
    it('America/New_York 01:30 on fall-back → EDT (05:30Z), not EST (06:30Z)', () => {
      expect(iso(resolveLocal('2026-11-01', '01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
    });
    it('America/Santiago 23:30 repeated → first (-03)', () => {
      expect(iso(resolveLocal('2026-04-04', '23:30', 'America/Santiago'))).toBe('2026-04-05T02:30:00.000Z');
    });
    it('Europe/Lisbon 01:30 repeated → WEST (00:30Z)', () => {
      expect(iso(resolveLocal('2026-10-25', '01:30', 'Europe/Lisbon'))).toBe('2026-10-25T00:30:00.000Z');
    });
  });
});

describe('calendar helpers', () => {
  it('addDays crosses months/years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('weekdayOf (0 = Sunday)', () => {
    expect(weekdayOf('2026-10-18')).toBe(0);
    expect(weekdayOf('2026-10-17')).toBe(6);
  });
  it('localDayRange handles a 23h day with skipped midnight', () => {
    const r = localDayRange('2026-09-06', 'America/Santiago');
    expect(r.to.getTime() - r.from.getTime()).toBe(23 * 3600_000);
  });
});
