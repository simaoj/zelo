import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, op, uuid, type TestClient, type TestContext } from '../../../test-support/app.js';

let ctx: TestContext;
let a: TestClient;
let b: TestClient;
beforeAll(async () => {
  ctx = await createTestContext();
  a = ctx.client();
  b = ctx.client();
  await a.signUp(); // profile tz America/Sao_Paulo
  await b.signUp();
});
afterAll(async () => {
  await ctx?.close();
});

const tz = 'America/Sao_Paulo';
const water = (consumedAt: string, amountMl: number, id = uuid()) => ({ ...op(), id, consumedAt, timezone: tz, amountMl });
const summary = async (c: TestClient, from: string, to: string) => (await c.get(`/hydration/summary?from=${from}&to=${to}`)).json();

describe('indexes', () => {
  it('creates waterEntries history index and partial unique active hydration goal', async () => {
    const db = ctx.container.db;
    const names = async (c: string) => (await db.collection(c).indexes()).map((i) => ({ key: i.key, unique: !!i.unique, partial: i.partialFilterExpression }));
    expect(await names('waterEntries')).toContainEqual({ key: { userId: 1, consumedAt: -1, _id: -1 }, unique: false, partial: undefined });
    expect(await names('hydrationGoals')).toContainEqual({ key: { userId: 1 }, unique: true, partial: { active: true } });
  });
});

describe('openapi', () => {
  it('documents the hydration routes', async () => {
    const doc = (await a.get('/openapi.json')).json() as { paths: Record<string, unknown> };
    for (const p of ['/api/v1/water-entries', '/api/v1/water-entries/{id}', '/api/v1/hydration/summary', '/api/v1/hydration/goal']) expect(doc.paths).toHaveProperty([p]);
  });
});

describe('water entries', () => {
  it('create, edit, delete (tombstone), undo by re-creating; version conflicts', async () => {
    const c = ctx.client();
    await c.signUp();
    const w = water('2026-09-10T12:00:00.000Z', 300);
    const created = await c.post('/water-entries', w);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: w.id, amountMl: 300, version: 0, notes: null, consumedAt: '2026-09-10T12:00:00.000Z', timezone: tz });

    const edited = await c.patch(`/water-entries/${w.id}`, { ...op(), expectedVersion: 0, amountMl: 500, notes: 'copo grande' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ amountMl: 500, version: 1, notes: 'copo grande' });

    const stale = await c.patch(`/water-entries/${w.id}`, { ...op(), expectedVersion: 0, amountMl: 200 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT', current: { id: w.id, version: 1, amountMl: 500 } });
    const staleDel = await c.del(`/water-entries/${w.id}`, { ...op(), expectedVersion: 0 });
    expect(staleDel.statusCode).toBe(409);

    expect((await c.del(`/water-entries/${w.id}`, { ...op(), expectedVersion: 1 })).statusCode).toBe(204);
    const doc = await ctx.container.db.collection('waterEntries').findOne({ _id: w.id as never });
    expect(doc?.deletedAt).toBeInstanceOf(Date);
    expect(doc?.version).toBe(2);
    expect((await c.get('/water-entries')).json().items).toEqual([]);
    expect((await c.del(`/water-entries/${w.id}`, { ...op(), expectedVersion: 2 })).statusCode).toBe(404);
    expect((await summary(c, '2026-09-10', '2026-09-10')).days[0]).toEqual({ date: '2026-09-10', totalMl: null, entryCount: 0 });

    // "undo" of a quick add at UI level = delete; undo of delete = new entry with a new id
    const redo = await c.post('/water-entries', water('2026-09-10T12:00:00.000Z', 500));
    expect(redo.statusCode).toBe(201);
    expect((await summary(c, '2026-09-10', '2026-09-10')).days[0]).toEqual({ date: '2026-09-10', totalMl: 500, entryCount: 1 });
    // reusing a tombstoned id is a conflict
    expect((await c.post('/water-entries', water('2026-09-10T12:00:00.000Z', 200, w.id))).statusCode).toBe(409);
  });

  it('validates amount (positive int) and rejects future instants', async () => {
    for (const amountMl of [0, -1, 1.5, 10_001]) {
      const r = await a.post('/water-entries', water('2026-09-10T12:00:00.000Z', amountMl));
      expect(r.statusCode).toBe(400);
      expect(r.json().fieldErrors).toHaveProperty('amountMl');
    }
    const future = await a.post('/water-entries', water(new Date(Date.now() + 10 * 60_000).toISOString(), 200));
    expect(future.statusCode).toBe(400);
    expect(future.json().fieldErrors).toHaveProperty('consumedAt');
  });

  it('paginates by consumedAt desc with cursor and from/to', async () => {
    const c = ctx.client();
    await c.signUp();
    const ids = [];
    for (const iso of ['2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z', '2026-09-03T10:00:00.000Z']) {
      ids.push((await c.post('/water-entries', water(iso, 200))).json().id as string);
    }
    const p1 = (await c.get('/water-entries?limit=2')).json();
    expect(p1.items.map((i: { id: string }) => i.id)).toEqual([ids[2], ids[1]]);
    const p2 = (await c.get(`/water-entries?limit=2&cursor=${p1.nextCursor}`)).json();
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual([ids[0]]);
    expect(p2.nextCursor).toBeNull();
    const ranged = (await c.get(`/water-entries?from=${encodeURIComponent('2026-09-02T00:00:00Z')}&to=${encodeURIComponent('2026-09-03T00:00:00Z')}`)).json();
    expect(ranged.items.map((i: { id: string }) => i.id)).toEqual([ids[1]]);
    expect((await c.get('/water-entries?cursor=garbage')).statusCode).toBe(400);
  });
});

describe('summary and goal', () => {
  it('entries just before/after local midnight land on the right day; totals, average and goal', async () => {
    const c = ctx.client();
    await c.signUp();
    await c.post('/water-entries', water('2026-09-21T02:59:00.000Z', 200)); // 20th 23:59 local
    await c.post('/water-entries', water('2026-09-21T03:00:00.000Z', 300)); // 21st 00:00 local
    await c.post('/water-entries', water('2026-09-21T23:00:00.000Z', 2500)); // 21st 20:00 local

    expect((await c.get('/hydration/goal')).statusCode).toBe(404);
    const put = await c.put('/hydration/goal', { ...op(), dailyTargetMl: 2000 });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ dailyTargetMl: 2000, version: 0 });
    expect((await c.put('/hydration/goal', { ...op(), dailyTargetMl: 0 })).statusCode).toBe(400);

    const s = await summary(c, '2026-09-20', '2026-09-22');
    expect(s).toMatchObject({
      timezone: tz,
      from: '2026-09-20',
      to: '2026-09-22',
      days: [
        { date: '2026-09-20', totalMl: 200, entryCount: 1 },
        { date: '2026-09-21', totalMl: 2800, entryCount: 2 }, // above the goal: real volume shown
        { date: '2026-09-22', totalMl: null, entryCount: 0 },
      ],
      goal: { dailyTargetMl: 2000, version: 0 },
      averageMlOnRecordedDays: 1500,
    });

    expect((await c.put('/hydration/goal', { ...op(), dailyTargetMl: 2500 })).json()).toMatchObject({ dailyTargetMl: 2500, version: 1 });
    expect((await c.get('/hydration/goal')).json()).toMatchObject({ dailyTargetMl: 2500 });
    expect((await c.del('/hydration/goal', { ...op() })).statusCode).toBe(204);
    expect((await c.get('/hydration/goal')).statusCode).toBe(404);
    expect((await c.del('/hydration/goal', op())).statusCode).toBe(404);
    expect((await summary(c, '2026-09-20', '2026-09-20')).goal).toBeNull();
  });

  it('rejects inverted ranges and spans over 400 days', async () => {
    expect((await a.get('/hydration/summary?from=2026-09-02&to=2026-09-01')).statusCode).toBe(400);
    expect((await a.get('/hydration/summary?from=2025-01-01&to=2026-02-05')).statusCode).toBe(400);
    expect((await a.get('/hydration/summary?from=2025-01-01&to=2026-02-04')).json().days).toHaveLength(400);
    expect((await a.get('/hydration/summary?from=bad&to=2026-02-04')).statusCode).toBe(400);
  });
});

describe('isolation', () => {
  it('a user never sees, edits or deletes another user’s water or goal', async () => {
    const w = water('2026-08-05T15:00:00.000Z', 400);
    await a.post('/water-entries', w);
    await a.put('/hydration/goal', { ...op(), dailyTargetMl: 1800 });
    expect((await b.get('/water-entries')).json().items.find((i: { id: string }) => i.id === w.id)).toBeUndefined();
    expect((await summary(b, '2026-08-05', '2026-08-05')).days[0].totalMl).toBeNull();
    expect((await b.patch(`/water-entries/${w.id}`, { ...op(), expectedVersion: 0, amountMl: 1 })).statusCode).toBe(404);
    expect((await b.del(`/water-entries/${w.id}`, { ...op(), expectedVersion: 0 })).statusCode).toBe(404);
    const reuse = await b.post('/water-entries', water('2026-08-05T15:00:00.000Z', 100, w.id));
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().current).toBeUndefined();
    expect((await b.get('/hydration/goal')).statusCode).toBe(404);
    expect((await summary(a, '2026-08-05', '2026-08-05')).days[0].totalMl).toBe(400);
  });
});

describe('idempotency and sync', () => {
  it('same operationId via REST replays without duplicates', async () => {
    const c = ctx.client();
    await c.signUp();
    const w = water('2026-09-05T12:00:00.000Z', 200);
    const r1 = await c.post('/water-entries', w);
    const r2 = await c.post('/water-entries', w);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    expect(await ctx.container.db.collection('waterEntries').countDocuments({ userId: c.userId })).toBe(1);
  });

  it('REST ↔ /sync/operations cross-replay (offline reconnection without duplicates)', async () => {
    const c = ctx.client();
    await c.signUp();
    const w = water('2026-09-06T12:00:00.000Z', 300);
    const create = { type: 'water.create', entityId: w.id, payload: w };
    const s1 = (await c.post('/sync/operations', { operations: [create] })).json();
    expect(s1.results[0]).toMatchObject({ operationId: w.operationId, status: 201, body: { id: w.id, amountMl: 300 } });
    // retried via REST (e.g. the queue flushed, response lost) → replay
    const rest = await c.post('/water-entries', w);
    expect(rest.statusCode).toBe(201);
    expect(rest.headers['idempotent-replayed']).toBe('true');
    // and replayed again via sync
    const s2 = (await c.post('/sync/operations', { operations: [create] })).json();
    expect(s2.results[0]).toMatchObject({ status: 201, body: { id: w.id } });

    const upd = { ...op(), expectedVersion: 0, amountMl: 350 };
    expect((await c.patch(`/water-entries/${w.id}`, upd)).statusCode).toBe(200);
    const s3 = (await c.post('/sync/operations', { operations: [{ type: 'water.update', entityId: w.id, payload: upd }] })).json();
    expect(s3.results[0]).toMatchObject({ status: 200, body: { version: 1, amountMl: 350 } });

    const del = { ...op(), expectedVersion: 1 };
    const s4 = (await c.post('/sync/operations', { operations: [{ type: 'water.delete', entityId: w.id, payload: del }] })).json();
    expect(s4.results[0]).toMatchObject({ status: 204 });
    const restDel = await c.del(`/water-entries/${w.id}`, del);
    expect(restDel.statusCode).toBe(204);
    expect(restDel.headers['idempotent-replayed']).toBe('true');

    expect(await ctx.container.db.collection('waterEntries').countDocuments({ userId: c.userId })).toBe(1);
    expect((await summary(c, '2026-09-06', '2026-09-06')).days[0].totalMl).toBeNull();

    // stale offline edit → 409 with current; another user's entity → 404
    const w2 = water('2026-09-06T13:00:00.000Z', 200);
    await c.post('/water-entries', w2);
    await c.patch(`/water-entries/${w2.id}`, { ...op(), expectedVersion: 0, amountMl: 250 });
    const stale = (await c.post('/sync/operations', { operations: [{ type: 'water.update', entityId: w2.id, payload: { ...op(), expectedVersion: 0, amountMl: 999 } }] })).json();
    expect(stale.results[0]).toMatchObject({ status: 409, error: { code: 'VERSION_CONFLICT', current: { amountMl: 250, version: 1 } } });
    const foreign = (await b.post('/sync/operations', { operations: [{ type: 'water.delete', entityId: w2.id, payload: { ...op(), expectedVersion: 1 } }] })).json();
    expect(foreign.results[0]).toMatchObject({ status: 404 });
  });

  it('bootstrap includes the last 90 days and the goal; changes feed has upserts and tombstones', async () => {
    const c = ctx.client();
    await c.signUp();
    const recent = water(new Date(Date.now() - 2 * 86_400_000).toISOString(), 250);
    const old = water(new Date(Date.now() - 120 * 86_400_000).toISOString(), 250);
    await c.post('/water-entries', recent);
    await c.post('/water-entries', old);
    await c.put('/hydration/goal', { ...op(), dailyTargetMl: 2000 });
    const snap = (await c.get('/sync/bootstrap')).json();
    expect(snap.waterEntries.map((e: { id: string }) => e.id)).toEqual([recent.id]);
    expect(snap.hydrationGoal).toMatchObject({ dailyTargetMl: 2000 });

    await c.patch(`/water-entries/${recent.id}`, { ...op(), expectedVersion: 0, amountMl: 300 });
    await c.del(`/water-entries/${recent.id}`, { ...op(), expectedVersion: 1 });
    await c.del('/hydration/goal', { ...op() });
    const ch = (await c.get(`/sync/changes?cursor=${snap.cursor}`)).json();
    expect(ch.changes).toHaveLength(2); // deduplicated per entity id
    expect(ch.changes).toContainEqual({ op: 'delete', entity: 'waterEntry', id: recent.id });
    expect(ch.changes).toContainEqual({ op: 'delete', entity: 'hydrationGoal', id: c.userId });
  });
});
