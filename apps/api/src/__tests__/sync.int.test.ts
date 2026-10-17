import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, op, uuid, type TestClient, type TestContext } from '../test-support/app.js';

let ctx: TestContext;
let a: TestClient;
beforeAll(async () => {
  ctx = await createTestContext();
  a = ctx.client();
  await a.signUp();
});
afterAll(async () => {
  await ctx?.close();
});

const tz = 'America/Sao_Paulo';

describe('sync', () => {
  it('bootstrap returns a snapshot and a cursor; changes after it include upserts and tombstones', async () => {
    const w1 = uuid();
    await a.post('/weights', { ...op(), id: w1, measuredAt: '2026-10-01T10:00:00.000Z', timezone: tz, weightKg: '82.35' });
    const boot = await a.get('/sync/bootstrap');
    expect(boot.statusCode).toBe(200);
    const snap = boot.json();
    expect(snap.profile.userId).toBe(a.userId);
    expect(snap.weightEntries.map((w: { id: string }) => w.id)).toEqual([w1]);
    expect(snap.weightGoal).toBeNull();
    expect(Array.isArray(snap.routineItems)).toBe(true);

    // nothing new yet
    const empty = (await a.get(`/sync/changes?cursor=${snap.cursor}`)).json();
    expect(empty).toEqual({ changes: [], cursor: snap.cursor, hasMore: false });

    const m1 = uuid();
    await a.post('/measurements', { ...op(), id: m1, measuredAt: '2026-10-01T10:00:00.000Z', timezone: tz, values: [{ type: 'waist', side: 'unspecified', valueCm: '80' }] });
    await a.patch(`/weights/${w1}`, { ...op(), expectedVersion: 0, weightKg: '82.4' });
    await a.del(`/weights/${w1}`, { ...op(), expectedVersion: 1 });
    await a.patch('/profile', { ...op(), expectedVersion: 0, displayName: 'Ana' });
    await a.put('/weight-goal', { ...op(), targetKg: '75' });

    const ch = (await a.get(`/sync/changes?cursor=${snap.cursor}`)).json();
    expect(ch.hasMore).toBe(false);
    // deduplicated per entity id: weight appears once, as a tombstone
    const weightChanges = ch.changes.filter((c: { id: string }) => c.id === w1);
    expect(weightChanges).toEqual([{ op: 'delete', entity: 'weightEntry', id: w1 }]);
    expect(ch.changes).toContainEqual(expect.objectContaining({ op: 'upsert', entity: 'measurementSession', id: m1 }));
    expect(ch.changes).toContainEqual(expect.objectContaining({ op: 'upsert', entity: 'profile', id: a.userId, data: expect.objectContaining({ displayName: 'Ana', version: 1 }) }));
    expect(ch.changes).toContainEqual(expect.objectContaining({ op: 'upsert', entity: 'weightGoal', data: expect.objectContaining({ targetKg: '75' }) }));

    const again = (await a.get(`/sync/changes?cursor=${ch.cursor}`)).json();
    expect(again.changes).toEqual([]);
  });

  it('rejects malformed cursors', async () => {
    expect((await a.get('/sync/changes?cursor=garbage')).statusCode).toBe(400);
  });

  it('operations run through the same use cases, in order, idempotently', async () => {
    const id = uuid();
    const create = { type: 'weight.create', entityId: id, payload: { ...op(), id, measuredAt: '2026-10-03T10:00:00.000Z', timezone: tz, weightKg: '80' } };
    const update = { type: 'weight.update', entityId: id, payload: { ...op(), expectedVersion: 0, weightKg: '80.2' } };
    const bp = uuid();
    const bpCreate = { type: 'bloodPressure.create', entityId: bp, payload: { ...op(), id: bp, measuredAt: '2026-10-03T10:00:00.000Z', timezone: tz, systolic: 120, diastolic: 80, pulseBpm: null } };
    const bad = { type: 'bloodPressure.create', entityId: uuid(), payload: { ...op(), systolic: 'x' } };
    const unusual = { type: 'bloodPressure.create', entityId: bp, payload: { ...op(), id: bp, measuredAt: '2026-10-03T10:00:00.000Z', timezone: tz, systolic: 80, diastolic: 90, pulseBpm: null } };

    const r1 = await a.post('/sync/operations', { operations: [create, update, bpCreate, bad, unusual] });
    expect(r1.statusCode).toBe(200);
    const results = r1.json().results;
    expect(results.map((r: { status: number }) => r.status)).toEqual([201, 200, 201, 400, 422]);
    expect(results[1].body).toMatchObject({ id, version: 1, weightKg: '80.2' });
    expect(results[3].error.code).toBe('VALIDATION_ERROR');
    expect(results[4].error.code).toBe('CONFIRMATION_REQUIRED');

    // replay of the whole batch: same results, no duplicates
    const r2 = await a.post('/sync/operations', { operations: [create, update, bpCreate] });
    expect(r2.json().results.map((r: { status: number }) => r.status)).toEqual([201, 200, 201]);
    expect(r2.json().results[1].body).toEqual(results[1].body);
    expect(await ctx.container.db.collection('weightEntries').countDocuments({ _id: id as never })).toBe(1);

    // same operationId via REST replays too (shared idempotency envelope)
    const rest = await a.patch(`/weights/${id}`, update.payload);
    expect(rest.statusCode).toBe(200);
    expect(rest.headers['idempotent-replayed']).toBe('true');

    // stale version from another device → conflict with current
    const stale = await a.post('/sync/operations', { operations: [{ type: 'weight.update', entityId: id, payload: { ...op(), expectedVersion: 0, weightKg: '79' } }] });
    expect(stale.json().results[0]).toMatchObject({ status: 409, error: { code: 'VERSION_CONFLICT', current: { id, version: 1 } } });
  });

  it('unauthenticated batch → 401', async () => {
    const anon = ctx.client();
    const res = await anon.post('/sync/operations', { operations: [{ type: 'weight.delete', entityId: uuid(), payload: { ...op(), expectedVersion: 0 } }] });
    expect(res.statusCode).toBe(401);
  });

  it('sign-up is atomic with profile creation and change log', async () => {
    const c = ctx.client();
    const { userId } = await c.signUp();
    expect(await ctx.container.db.collection('profiles').countDocuments({ userId })).toBe(1);
    expect(await ctx.container.db.collection('syncCounters').findOne({ _id: userId as never })).toMatchObject({ seq: 1 });
  });
});
