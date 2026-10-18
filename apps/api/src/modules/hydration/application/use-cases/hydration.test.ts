import { describe, expect, it } from 'vitest';
import type { ChangeLog, TxContext, UnitOfWork } from '../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryParams } from '../../../../shared/application/repository-errors.js';
import { NotFoundError, ValidationError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { FixedClock } from '../../../../shared/adapters/system-clock.js';
import type { HydrationGoal } from '../../domain/hydration-goal.js';
import type { WaterEntry } from '../../domain/water-entry.js';
import type { HydrationGoalRepository, WaterEntryRepository } from '../ports/index.js';
import { bootstrapWindowStart, createHydrationUseCases } from './index.js';

const desc = (a: WaterEntry, b: WaterEntry) => b.consumedAt.getTime() - a.consumedAt.getTime() || (a.id < b.id ? 1 : -1);

class FakeEntries implements WaterEntryRepository {
  rows = new Map<string, WaterEntry>();
  live(userId: string) {
    return [...this.rows.values()].filter((e) => e.userId === userId && !e.deletedAt).sort(desc);
  }
  async findById(userId: string, id: string) {
    const e = this.rows.get(id);
    return e && e.userId === userId ? e : null;
  }
  async ownerOf(id: string) {
    return this.rows.get(id)?.userId ?? null;
  }
  async insert(e: WaterEntry) {
    if (this.rows.has(e.id)) throw new DuplicateIdError(e.id);
    this.rows.set(e.id, e);
  }
  async updateIfVersion(e: WaterEntry, v: number) {
    const cur = this.rows.get(e.id);
    if (!cur || cur.userId !== e.userId || cur.version !== v) return false;
    this.rows.set(e.id, e);
    return true;
  }
  async page(userId: string, p: HistoryParams) {
    const all = this.live(userId);
    return { items: all.slice(0, p.limit), nextCursor: null, lookahead: all[p.limit] ?? null };
  }
  async listLiveBetween(userId: string, from: Date, to: Date | null) {
    return this.live(userId)
      .reverse()
      .filter((e) => e.consumedAt >= from && (!to || e.consumedAt < to));
  }
}

class FakeGoals implements HydrationGoalRepository {
  rows: HydrationGoal[] = [];
  async findActive(userId: string) {
    return this.rows.find((g) => g.userId === userId && g.active) ?? null;
  }
  async insert(g: HydrationGoal) {
    this.rows.push(g);
  }
  async updateIfVersion(g: HydrationGoal, v: number) {
    const i = this.rows.findIndex((r) => r.id === g.id && r.version === v && r.active);
    if (i < 0) return false;
    this.rows[i] = g;
    return true;
  }
  async deactivate(userId: string) {
    const g = this.rows.find((r) => r.userId === userId && r.active);
    if (!g) return false;
    g.active = false;
    return true;
  }
}

class FakeChangeLog implements ChangeLog {
  log: string[] = [];
  async record(_tx: TxContext, userId: string, c: { entity: string; id: string; op: 'upsert' | 'delete' }) {
    this.log.push(`${userId}:${c.entity}:${c.op}:${c.id}`);
  }
}

const tx = {} as TxContext;
const uow: UnitOfWork = { run: (w) => w(tx) };
const actor = { userId: 'user-a' };
const setup = (tz = 'America/Sao_Paulo') => {
  const entries = new FakeEntries();
  const goals = new FakeGoals();
  const changes = new FakeChangeLog();
  const clock = new FixedClock(new Date('2026-10-18T15:00:00Z'));
  let n = 0;
  const timezones = { getTimezone: async () => tz };
  const uc = createHydrationUseCases({ entries, goals, timezones, clock, ids: { next: () => `id-${++n}` }, changeLog: changes, uow });
  return { entries, goals, changes, clock, timezones, uc };
};
const req = (id: string, iso: string, amountMl: number) => ({ operationId: 'op', id, consumedAt: iso, timezone: 'America/Sao_Paulo', amountMl });

describe('water intake use cases (fakes)', () => {
  it('register → update → delete records changes and tombstones', async () => {
    const s = setup();
    const c = await s.uc.registerWaterIntake.execute(actor, req('w1', '2026-10-18T12:00:00Z', 200), tx);
    expect(c).toMatchObject({ id: 'w1', amountMl: 200, version: 0, notes: null });
    const u = await s.uc.updateWaterIntake.execute(actor, 'w1', { operationId: 'o2', expectedVersion: 0, amountMl: 350, notes: 'garrafa' }, tx);
    expect(u).toMatchObject({ amountMl: 350, version: 1, notes: 'garrafa' });
    await s.uc.deleteWaterIntake.execute(actor, 'w1', 1, tx);
    expect(s.entries.rows.get('w1')?.deletedAt).toBeInstanceOf(Date);
    expect(s.changes.log).toEqual(['user-a:waterEntry:upsert:w1', 'user-a:waterEntry:upsert:w1', 'user-a:waterEntry:delete:w1']);
    await expect(s.uc.deleteWaterIntake.execute(actor, 'w1', 2, tx)).rejects.toBeInstanceOf(NotFoundError);
    expect((await s.uc.listWaterEntries.execute(actor, { limit: 50 })).items).toEqual([]);
  });

  it('stale version → VERSION_CONFLICT with current; foreign id → 404; id reuse → conflict without leaking', async () => {
    const s = setup();
    await s.uc.registerWaterIntake.execute({ userId: 'other' }, req('x', '2026-10-18T12:00:00Z', 200), tx);
    await expect(s.uc.updateWaterIntake.execute(actor, 'x', { operationId: 'o', expectedVersion: 0, amountMl: 1 }, tx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.uc.registerWaterIntake.execute(actor, req('x', '2026-10-18T12:00:00Z', 300), tx)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', current: undefined });

    await s.uc.registerWaterIntake.execute(actor, req('m', '2026-10-18T12:00:00Z', 200), tx);
    await s.uc.updateWaterIntake.execute(actor, 'm', { operationId: 'o', expectedVersion: 0, amountMl: 250 }, tx);
    const err = await s.uc.deleteWaterIntake.execute(actor, 'm', 0, tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect((err as VersionConflictError).current).toMatchObject({ id: 'm', version: 1, amountMl: 250 });
  });

  it('rejects future and invalid amounts', async () => {
    const s = setup();
    await expect(s.uc.registerWaterIntake.execute(actor, req('f', '2026-10-18T15:05:00Z', 200), tx)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.uc.registerWaterIntake.execute(actor, req('z', '2026-10-18T12:00:00Z', 0), tx)).rejects.toBeInstanceOf(ValidationError);
    expect(s.entries.rows.size).toBe(0);
    expect(s.changes.log).toEqual([]);
  });
});

describe('summary, day and goal', () => {
  it('summary: one row per local date, null for absent days, goal and average', async () => {
    const s = setup();
    await s.uc.registerWaterIntake.execute(actor, req('a', '2026-10-16T02:59:00Z', 200), tx); // 15th local
    await s.uc.registerWaterIntake.execute(actor, req('b', '2026-10-16T03:00:00Z', 300), tx); // 16th local
    await s.uc.registerWaterIntake.execute(actor, req('c', '2026-10-16T20:00:00Z', 500), tx); // 16th local
    await s.uc.registerWaterIntake.execute({ userId: 'other' }, req('o', '2026-10-16T20:00:00Z', 900), tx);
    await s.uc.hydrationGoal.set(actor, { dailyTargetMl: 600 }, tx);
    const sum = await s.uc.getHydrationSummary.execute(actor, { from: '2026-10-15', to: '2026-10-17' });
    expect(sum).toEqual({
      timezone: 'America/Sao_Paulo',
      from: '2026-10-15',
      to: '2026-10-17',
      days: [
        { date: '2026-10-15', totalMl: 200, entryCount: 1 },
        { date: '2026-10-16', totalMl: 800, entryCount: 2 },
        { date: '2026-10-17', totalMl: null, entryCount: 0 },
      ],
      goal: expect.objectContaining({ dailyTargetMl: 600, version: 0 }),
      averageMlOnRecordedDays: 500,
    });
    await expect(s.uc.getHydrationSummary.execute(actor, { from: '2026-10-17', to: '2026-10-15' })).rejects.toBeInstanceOf(ValidationError);
    const day = await s.uc.getHydrationDay.execute('user-a', '2026-10-16', 'America/Sao_Paulo');
    expect(day).toEqual({ totalMl: 800, entryCount: 2, goal: expect.objectContaining({ dailyTargetMl: 600 }), lastEntryAt: '2026-10-16T20:00:00.000Z' });
    expect(await s.uc.getHydrationDay.execute('user-a', '2026-10-17', 'America/Sao_Paulo')).toEqual({
      totalMl: null,
      entryCount: 0,
      goal: expect.anything(),
      lastEntryAt: null,
    });
  });

  it('goal: get 404 when none, set creates then updates, remove deactivates; sync id = userId', async () => {
    const s = setup();
    await expect(s.uc.hydrationGoal.get(actor)).rejects.toBeInstanceOf(NotFoundError);
    expect(await s.uc.hydrationGoal.set(actor, { dailyTargetMl: 2000 }, tx)).toMatchObject({ dailyTargetMl: 2000, version: 0 });
    expect(await s.uc.hydrationGoal.set(actor, { dailyTargetMl: 2500 }, tx)).toMatchObject({ dailyTargetMl: 2500, version: 1 });
    await s.uc.hydrationGoal.remove(actor, tx);
    await expect(s.uc.hydrationGoal.remove(actor, tx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.uc.hydrationGoal.get(actor)).rejects.toBeInstanceOf(NotFoundError);
    expect(s.changes.log).toEqual(['user-a:hydrationGoal:upsert:user-a', 'user-a:hydrationGoal:upsert:user-a', 'user-a:hydrationGoal:delete:user-a']);
  });

  it('bootstrap window = 90 local days including today (profile tz)', async () => {
    const s = setup();
    // now = 2026-10-18T15:00Z → today 2026-10-18 in SP; window starts 2026-07-21 00:00 -03:00
    expect((await bootstrapWindowStart('u', s.clock, s.timezones)).toISOString()).toBe('2026-07-21T03:00:00.000Z');
  });
});
