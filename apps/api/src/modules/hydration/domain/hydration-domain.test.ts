import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { assertSummaryRange, averageOnRecordedDays, dailyTotals } from './daily-totals.js';
import { changeHydrationGoal, createHydrationGoal } from './hydration-goal.js';
import { localDateOf, localRange, spanDays } from './local-date.js';
import { changeWaterEntry, createWaterEntry, deleteWaterEntry } from './water-entry.js';

const now = new Date('2026-10-18T12:00:00Z');
const base = { id: 'w1', userId: 'u', consumedAt: new Date('2026-10-18T11:00:00Z'), timezone: 'America/Sao_Paulo', amountMl: 300 };

describe('WaterEntry', () => {
  it('accepts a positive integer amount up to 10000 ml', () => {
    expect(createWaterEntry(base, now)).toMatchObject({ amountMl: 300, version: 0, deletedAt: null, notes: null });
    expect(createWaterEntry({ ...base, amountMl: 10_000 }, now).amountMl).toBe(10_000);
  });

  it.each([0, -200, 1.5, 10_001, Number.NaN])('rejects amount %s', (amountMl) => {
    expect(() => createWaterEntry({ ...base, amountMl }, now)).toThrow(ValidationError);
  });

  it('rejects future consumedAt beyond the 60s skew tolerance, accepts retroactive', () => {
    expect(() => createWaterEntry({ ...base, consumedAt: new Date(now.getTime() + 61_000) }, now)).toThrow(/futuro/);
    expect(createWaterEntry({ ...base, consumedAt: new Date(now.getTime() + 30_000) }, now)).toBeTruthy();
    expect(createWaterEntry({ ...base, consumedAt: new Date('2025-01-01T00:00:00Z') }, now)).toBeTruthy();
    const err = (() => {
      try {
        createWaterEntry({ ...base, consumedAt: new Date('2027-01-01T00:00:00Z') }, now);
      } catch (e) {
        return e as ValidationError;
      }
    })();
    expect(err?.fieldErrors).toHaveProperty('consumedAt');
  });

  it('validates notes length and timezone', () => {
    expect(() => createWaterEntry({ ...base, notes: 'x'.repeat(1001) }, now)).toThrow(ValidationError);
    expect(() => createWaterEntry({ ...base, timezone: 'Mars/Base' }, now)).toThrow(ValidationError);
    expect(createWaterEntry({ ...base, notes: '  ' }, now).notes).toBeNull();
  });

  it('edits bump version and re-validate; delete is a tombstone', () => {
    const e = createWaterEntry(base, now);
    const later = new Date(now.getTime() + 1000);
    const c = changeWaterEntry(e, { amountMl: 500 }, later);
    expect(c).toMatchObject({ amountMl: 500, version: 1, updatedAt: later });
    expect(() => changeWaterEntry(e, { amountMl: 0 }, later)).toThrow(ValidationError);
    expect(() => changeWaterEntry(e, { consumedAt: new Date('2030-01-01T00:00:00Z') }, later)).toThrow(ValidationError);
    expect(deleteWaterEntry(c, later)).toMatchObject({ version: 2, deletedAt: later });
  });
});

describe('HydrationGoal', () => {
  it('requires a positive integer target', () => {
    const g = createHydrationGoal({ id: 'g', userId: 'u', dailyTargetMl: 2000 }, now);
    expect(g).toMatchObject({ dailyTargetMl: 2000, active: true, version: 0 });
    expect(changeHydrationGoal(g, 2500, now)).toMatchObject({ dailyTargetMl: 2500, version: 1 });
    expect(() => createHydrationGoal({ id: 'g', userId: 'u', dailyTargetMl: 0 }, now)).toThrow(ValidationError);
    expect(() => changeHydrationGoal(g, 1.2, now)).toThrow(ValidationError);
  });
});

describe('daily grouping by profile timezone', () => {
  const sp = 'America/Sao_Paulo'; // UTC-3, no DST since 2019
  const e = (iso: string, amountMl: number, deletedAt: Date | null = null) => ({ consumedAt: new Date(iso), amountMl, deletedAt });

  it('entries just before/after local midnight land on the right day (America/Sao_Paulo)', () => {
    const days = dailyTotals(
      [e('2026-10-18T02:59:59Z', 200) /* 17th 23:59:59 local */, e('2026-10-18T03:00:00Z', 300) /* 18th 00:00 local */],
      '2026-10-17',
      '2026-10-18',
      sp,
    );
    expect(days).toEqual([
      { date: '2026-10-17', totalMl: 200, entryCount: 1 },
      { date: '2026-10-18', totalMl: 300, entryCount: 1 },
    ]);
  });

  it('handles a DST zone (America/New_York, fall back 2026-11-01)', () => {
    const ny = 'America/New_York';
    // 2026-11-01 is 25h long; 04:30Z = 00:30 EDT (Nov 1), 2026-11-02T04:59Z = 23:59 EST (Nov 1), 05:00Z = 00:00 EST (Nov 2)
    const days = dailyTotals(
      [e('2026-11-01T03:59:00Z', 100), e('2026-11-01T04:30:00Z', 200), e('2026-11-02T04:59:00Z', 300), e('2026-11-02T05:00:00Z', 400)],
      '2026-10-31',
      '2026-11-02',
      ny,
    );
    expect(days.map((d) => d.totalMl)).toEqual([100, 500, 400]);
    const r = localRange('2026-11-01', '2026-11-01', ny);
    expect(r.to.getTime() - r.from.getTime()).toBe(25 * 3600_000);
    // spring forward: 2026-03-08 is 23h long
    const s = localRange('2026-03-08', '2026-03-08', ny);
    expect(s.to.getTime() - s.from.getTime()).toBe(23 * 3600_000);
    expect(localDateOf(new Date('2026-03-08T04:59:00Z'), ny)).toBe('2026-03-07');
  });

  it('a day without live entries is null (never 0); deleted entries do not count', () => {
    const days = dailyTotals([e('2026-10-10T12:00:00Z', 250, new Date())], '2026-10-10', '2026-10-11', sp);
    expect(days).toEqual([
      { date: '2026-10-10', totalMl: null, entryCount: 0 },
      { date: '2026-10-11', totalMl: null, entryCount: 0 },
    ]);
  });

  it('shows the real volume (no clamping) and averages over recorded days only', () => {
    const days = dailyTotals([e('2026-10-10T12:00:00Z', 5000), e('2026-10-10T13:00:00Z', 1000), e('2026-10-12T12:00:00Z', 1001)], '2026-10-10', '2026-10-13', sp);
    expect(days.map((d) => d.totalMl)).toEqual([6000, null, 1001, null]);
    expect(averageOnRecordedDays(days)).toBe(3501); // (6000+1001)/2 = 3500.5 → 3501
    expect(averageOnRecordedDays(dailyTotals([], '2026-10-10', '2026-10-13', sp))).toBeNull();
  });

  it('validates the summary range (inclusive, max 400 days)', () => {
    expect(spanDays('2026-10-10', '2026-10-10')).toBe(1);
    expect(() => assertSummaryRange('2026-10-11', '2026-10-10')).toThrow(ValidationError);
    expect(() => assertSummaryRange('2025-01-01', '2026-02-04')).not.toThrow(); // 400 days
    expect(() => assertSummaryRange('2025-01-01', '2026-02-05')).toThrow(ValidationError);
  });
});
