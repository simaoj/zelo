// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Occurrence, WaterEntry, WeightEntry } from '@zelo/contracts';
import {
  activityForDay,
  composeDashboard,
  datesBetween,
  deriveOccurrenceState,
  hydrationForDay,
  localDateIn,
  pageLocal,
  pageWater,
  pageWorkouts,
  subtractDecimal,
  summarizeHydration,
  summarizeSteps,
  withDeltas,
} from '../local-queries';
import { steps, workout } from './fakes';

const w = (id: string, measuredAt: string, weightKg: string): WeightEntry => ({
  id, measuredAt, weightKg, version: 1, createdAt: measuredAt, updatedAt: measuredAt, timezone: 'America/Sao_Paulo', notes: null, deltaKg: null,
});

describe('local queries', () => {
  it('computes exact deltas in chronological order', () => {
    expect(subtractDecimal('82.35', '82.4')).toBe('-0.05');
    expect(subtractDecimal('80', '79.5')).toBe('0.5');
    const out = withDeltas([w('b', '2026-10-02T00:00:00Z', '81.9'), w('a', '2026-10-01T00:00:00Z', '82.35')]);
    expect(Object.fromEntries(out.map((e) => [e.id, e.deltaKg]))).toEqual({ a: null, b: '-0.45' });
  });

  it('pages desc with [from, to) and an opaque cursor', () => {
    const items = Array.from({ length: 5 }, (_, i) => w(`id${i}`, `2026-10-0${i + 1}T00:00:00.000Z`, '80'));
    const p1 = pageLocal(items, { limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(['id4', 'id3']);
    const p2 = pageLocal(items, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual(['id2', 'id1']);
    const p3 = pageLocal(items, { limit: 2, cursor: p2.nextCursor! });
    expect(p3).toEqual({ items: [items[0]], nextCursor: null });
    expect(pageLocal(items, { from: '2026-10-02T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' }).items.map((i) => i.id)).toEqual(['id2', 'id1']);
  });

  it('derives occurrence state without ever converting absence to not_taken', () => {
    const o = { scheduledAt: '2026-10-17T10:00:00.000Z', intake: null } as Occurrence;
    expect(deriveOccurrenceState(o, new Date('2026-10-17T09:00:00Z'))).toBe('scheduled');
    expect(deriveOccurrenceState(o, new Date('2026-12-17T09:00:00Z'))).toBe('unrecorded');
  });

  it('composes the dashboard like the server', () => {
    expect(localDateIn('America/Sao_Paulo', new Date('2026-10-17T02:00:00Z'))).toBe('2026-10-16');
    const d = composeDashboard({
      date: '2026-10-17',
      profile: { userId: 'u', displayName: 'Ana', timezone: 'America/Sao_Paulo', visibleModules: [], remindersEnabled: true, version: 1, updatedAt: '' },
      weights: [w('a', '2026-10-01T00:00:00Z', '82'), w('b', '2026-10-05T00:00:00Z', '81.5')],
      bloodPressure: [],
      measurements: [],
      occurrences: [],
      water: [],
      hydrationGoal: null,
      steps: [],
      workouts: [],
      activityGoal: null,
      now: new Date('2026-10-17T12:00:00Z'),
    });
    expect(d.latestWeight).toMatchObject({ id: 'b', deltaKg: '-0.5' });
    expect(d.weightSparkline.map((s) => s.weightKg)).toEqual(['82', '81.5']);
    expect(d.displayName).toBe('Ana');
    // absence is not zero
    expect(d.hydration).toEqual({ totalMl: null, entryCount: 0, goal: null, lastEntryAt: null });
    expect(d.activity.steps).toEqual({ date: '2026-10-17', count: null, partial: true, receivedAt: null });
    expect(d.activity).toMatchObject({ workoutCount: 0, workoutSeconds: 0, lastReceivedAt: null });
  });
});

const water = (id: string, consumedAt: string, amountMl: number): WaterEntry => ({
  id, consumedAt, amountMl, timezone: 'America/Sao_Paulo', notes: null, version: 1, createdAt: consumedAt, updatedAt: consumedAt,
});
const TZ = 'America/Sao_Paulo'; // UTC-3, no DST in 2026

describe('hydration (profile tz)', () => {
  it('groups entries near local midnight by the PROFILE timezone (23:59 vs 00:01)', () => {
    const entries = [
      water('a', '2026-10-18T02:59:00.000Z', 200), // 17/10 23:59 in São Paulo
      water('b', '2026-10-18T03:01:00.000Z', 300), // 18/10 00:01 in São Paulo
    ];
    const s = summarizeHydration({ from: '2026-10-16', to: '2026-10-18', timezone: TZ, entries, goal: null });
    expect(s.days).toEqual([
      { date: '2026-10-16', totalMl: null, entryCount: 0 },
      { date: '2026-10-17', totalMl: 200, entryCount: 1 },
      { date: '2026-10-18', totalMl: 300, entryCount: 1 },
    ]);
    // average over recorded days only (absent 16/10 is not a zero)
    expect(s.averageMlOnRecordedDays).toBe(250);
    // a UTC grouping would have put both on 18/10 — make sure we are not doing that
    expect(summarizeHydration({ from: '2026-10-18', to: '2026-10-18', timezone: 'UTC', entries, goal: null }).days[0]!.totalMl).toBe(500);
  });

  it('distinguishes no records (null) from a value and carries the goal; volume above the goal is kept', () => {
    const goal = { dailyTargetMl: 2000, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' };
    const none = summarizeHydration({ from: '2026-10-18', to: '2026-10-18', timezone: TZ, entries: [], goal });
    expect(none.days[0]!.totalMl).toBeNull();
    expect(none.averageMlOnRecordedDays).toBeNull();
    expect(none.goal).toEqual(goal);
    const many = Array.from({ length: 6 }, (_, i) => water(`w${i}`, `2026-10-18T1${i}:00:00.000Z`, 500));
    const day = hydrationForDay('2026-10-18', TZ, many, goal);
    expect(day).toMatchObject({ totalMl: 3000, entryCount: 6, lastEntryAt: '2026-10-18T15:00:00.000Z' });
  });

  it('pages water history by consumedAt desc with [from, to)', () => {
    const entries = [water('a', '2026-10-10T10:00:00.000Z', 200), water('b', '2026-10-11T10:00:00.000Z', 300), water('c', '2026-10-12T10:00:00.000Z', 500)];
    const p1 = pageWater(entries, { limit: 2 });
    expect(p1.items.map((e) => e.id)).toEqual(['c', 'b']);
    expect(p1.items[0]).not.toHaveProperty('measuredAt');
    const p2 = pageWater(entries, { limit: 2, cursor: p1.nextCursor! });
    expect(p2).toEqual({ items: [entries[0]], nextCursor: null });
    expect(pageWater(entries, { from: '2026-10-11T00:00:00.000Z', to: '2026-10-12T10:00:00.000Z' }).items.map((e) => e.id)).toEqual(['b']);
  });
});

describe('activity (read-only replica)', () => {
  it('steps summary: no data (null) vs reported zero, partial today, average over days with data, lastReceivedAt', () => {
    const s = summarizeSteps({
      from: '2026-10-15',
      to: '2026-10-18',
      today: '2026-10-18',
      steps: [steps('2026-10-16', 0, '2026-10-17T01:00:00.000Z'), steps('2026-10-17', 8000, '2026-10-18T01:00:00.000Z'), steps('2026-10-18', 1000, '2026-10-18T13:00:00.000Z')],
      workouts: [workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18', 1800, '2026-10-18T14:00:00.000Z')],
      goal: null,
    });
    expect(s.days.map((d) => [d.date, d.count, d.partial])).toEqual([
      ['2026-10-15', null, false],
      ['2026-10-16', 0, false],
      ['2026-10-17', 8000, false],
      ['2026-10-18', 1000, true],
    ]);
    expect(s.averageOnDaysWithData).toBe(3000); // (0 + 8000 + 1000) / 3 — the no-data day is excluded, the zero is not
    expect(s.lastReceivedAt).toBe('2026-10-18T14:00:00.000Z'); // across steps AND workouts
    const empty = summarizeSteps({ from: '2026-10-18', to: '2026-10-18', today: '2026-10-18', steps: [], workouts: [], goal: null });
    expect(empty).toMatchObject({ averageOnDaysWithData: null, lastReceivedAt: null });
    expect(empty.days[0]).toEqual({ date: '2026-10-18', count: null, partial: true, receivedAt: null });
  });

  it('activity of a day sums workout durations of that local date', () => {
    const ws = [workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18', 1800), workout('Walking', '2026-10-18T20:00:00.000Z', '2026-10-18', 600), workout('Running', '2026-10-17T10:00:00.000Z', '2026-10-17', 900)];
    const a = activityForDay({ date: '2026-10-18', today: '2026-10-18', steps: [], workouts: ws, goal: { dailyStepsTarget: 8000, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' } });
    expect(a).toMatchObject({ date: '2026-10-18', workoutCount: 2, workoutSeconds: 2400, stepsGoal: { dailyStepsTarget: 8000 } });
  });

  it('workouts: filter by local-date period and exact name, desc paging, distinct names', () => {
    const ws = [
      workout('Running', '2026-10-10T10:00:00.000Z', '2026-10-10'),
      workout('Walking', '2026-10-11T10:00:00.000Z', '2026-10-11'),
      workout('Running', '2026-10-12T10:00:00.000Z', '2026-10-12'),
      workout('Running', '2026-10-14T10:00:00.000Z', '2026-10-14'),
    ];
    const p1 = pageWorkouts(ws, { name: 'Running', from: '2026-10-10', to: '2026-10-12', limit: 1 });
    expect(p1.items.map((w) => w.startedAt)).toEqual(['2026-10-12T10:00:00.000Z']);
    expect(p1.items[0]).not.toHaveProperty('measuredAt');
    expect(p1.availableNames).toEqual(['Running', 'Walking']);
    const p2 = pageWorkouts(ws, { name: 'Running', from: '2026-10-10', to: '2026-10-12', limit: 1, cursor: p1.nextCursor! });
    expect(p2.items.map((w) => w.startedAt)).toEqual(['2026-10-10T10:00:00.000Z']);
    expect(p2.nextCursor).toBeNull();
    expect(pageWorkouts(ws, {}).items).toHaveLength(4);
  });

  it('datesBetween is inclusive and calendar-based', () => {
    expect(datesBetween('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(datesBetween('2026-03-02', '2026-03-01')).toEqual([]);
  });
});
