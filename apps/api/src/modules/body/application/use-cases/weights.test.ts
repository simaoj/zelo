import { describe, expect, it } from 'vitest';
import type { ChangeLog, TxContext } from '../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryParams } from '../../../../shared/application/repository-errors.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { FixedClock } from '../../../../shared/adapters/system-clock.js';
import { chronologicalCompare, type WeightEntry } from '../../domain/entities/weight-entry.js';
import type { Position, WeightRepository } from '../ports/out/index.js';
import { DeleteWeight, ListWeights, RegisterWeight, UpdateWeight, WeightPresenter } from './weights.js';

/** In-memory fake of the WeightRepository port. */
class FakeWeights implements WeightRepository {
  rows = new Map<string, WeightEntry>();
  live(userId: string) {
    return [...this.rows.values()].filter((e) => e.userId === userId && !e.deletedAt).sort(chronologicalCompare);
  }
  async ownerOf(id: string) {
    return this.rows.get(id)?.userId ?? null;
  }
  async findById(userId: string, id: string) {
    const e = this.rows.get(id);
    return e && e.userId === userId ? e : null;
  }
  async insert(e: WeightEntry) {
    if (this.rows.has(e.id)) throw new DuplicateIdError(e.id);
    this.rows.set(e.id, e);
  }
  async updateIfVersion(e: WeightEntry, v: number) {
    const cur = this.rows.get(e.id);
    if (!cur || cur.userId !== e.userId || cur.version !== v) return false;
    this.rows.set(e.id, e);
    return true;
  }
  async page(userId: string, p: HistoryParams) {
    const all = this.live(userId).reverse();
    return { items: all.slice(0, p.limit), nextCursor: null, lookahead: all[p.limit] ?? null };
  }
  async previousOf(userId: string, pos: Position) {
    return this.live(userId).filter((e) => chronologicalCompare(e, pos) < 0).pop() ?? null;
  }
  async nextOf(userId: string, pos: Position) {
    return this.live(userId).find((e) => chronologicalCompare(e, pos) > 0) ?? null;
  }
  async latest(userId: string, n: number) {
    return this.live(userId).reverse().slice(0, n);
  }
  async listLive(userId: string) {
    return this.live(userId);
  }
}

class FakeChangeLog implements ChangeLog {
  log: { userId: string; entity: string; id: string; op: string }[] = [];
  async record(_tx: TxContext, userId: string, c: { entity: string; id: string; op: 'upsert' | 'delete' }) {
    this.log.push({ userId, ...c });
  }
}

const tx = {} as TxContext;
const actor = { userId: 'user-a' };
const setup = () => {
  const repo = new FakeWeights();
  const clock = new FixedClock(new Date('2026-10-17T12:00:00Z'));
  const changes = new FakeChangeLog();
  const presenter = new WeightPresenter(repo);
  return {
    repo,
    changes,
    register: new RegisterWeight(repo, clock, changes, presenter),
    update: new UpdateWeight(repo, clock, changes, presenter),
    remove: new DeleteWeight(repo, clock, changes, presenter),
    list: new ListWeights(repo),
  };
};
const req = (id: string, iso: string, kg: string) => ({ operationId: 'op', id, measuredAt: iso, timezone: 'UTC', weightKg: kg });

describe('weight use cases (fakes)', () => {
  it('register computes delta and emits change for the successor', async () => {
    const s = setup();
    await s.register.execute(actor, req('b', '2026-10-02T00:00:00Z', '80'), tx);
    const a = await s.register.execute(actor, req('a', '2026-10-01T00:00:00Z', '81'), tx);
    expect(a.deltaKg).toBeNull();
    expect(s.changes.log.map((c) => `${c.op}:${c.id}`)).toEqual(['upsert:b', 'upsert:a', 'upsert:b']);
    const page = await s.list.execute(actor, { limit: 50 });
    expect(page.items.map((i) => [i.id, i.deltaKg])).toEqual([['b', '-1'], ['a', null]]);
  });

  it('reusing an id of another user conflicts without revealing it', async () => {
    const s = setup();
    await s.register.execute({ userId: 'other' }, req('x', '2026-10-01T00:00:00Z', '60'), tx);
    await expect(s.register.execute(actor, req('x', '2026-10-01T00:00:00Z', '61'), tx)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', current: undefined });
  });

  it('update/delete: foreign id → 404, stale version → conflict with current', async () => {
    const s = setup();
    await s.register.execute({ userId: 'other' }, req('x', '2026-10-01T00:00:00Z', '60'), tx);
    await expect(s.update.execute(actor, 'x', { operationId: 'o', expectedVersion: 0, weightKg: '1' }, tx)).rejects.toBeInstanceOf(NotFoundError);
    await s.register.execute(actor, req('m', '2026-10-01T00:00:00Z', '70'), tx);
    await s.update.execute(actor, 'm', { operationId: 'o', expectedVersion: 0, weightKg: '71' }, tx);
    const err = await s.remove.execute(actor, 'm', 0, tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect((err as VersionConflictError).current).toMatchObject({ id: 'm', version: 1, weightKg: '71' });
    await s.remove.execute(actor, 'm', 1, tx);
    expect(s.repo.rows.get('m')?.deletedAt).toBeInstanceOf(Date);
    await expect(s.remove.execute(actor, 'm', 2, tx)).rejects.toBeInstanceOf(NotFoundError);
  });
});
