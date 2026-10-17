import { Decimal128 } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, op, uuid, type TestClient, type TestContext } from '../test-support/app.js';

let ctx: TestContext;
let a: TestClient;
let b: TestClient;
beforeAll(async () => {
  ctx = await createTestContext();
  a = ctx.client();
  b = ctx.client();
  await a.signUp();
  await b.signUp();
});
afterAll(async () => {
  await ctx?.close();
});

const tz = 'America/Sao_Paulo';
const at = (iso: string) => new Date(iso).toISOString();

describe('indexes (spec §7)', () => {
  it('creates the mandatory indexes', async () => {
    const db = ctx.container.db;
    const names = async (c: string) => (await db.collection(c).indexes()).map((i) => ({ key: i.key, unique: !!i.unique, partial: i.partialFilterExpression }));
    expect(await names('users')).toContainEqual({ key: { emailNormalized: 1 }, unique: true, partial: undefined });
    expect(await names('profiles')).toContainEqual({ key: { userId: 1 }, unique: true, partial: undefined });
    expect(await names('idempotencyKeys')).toContainEqual({ key: { userId: 1, operationId: 1 }, unique: true, partial: undefined });
    expect(await names('changes')).toContainEqual({ key: { userId: 1, seq: 1 }, unique: true, partial: undefined });
    expect(await names('weightGoals')).toContainEqual({ key: { userId: 1 }, unique: true, partial: { active: true } });
    for (const c of ['weightEntries', 'measurementSessions', 'bloodPressureEntries']) {
      expect(await names(c)).toContainEqual({ key: { userId: 1, measuredAt: -1, _id: -1 }, unique: false, partial: undefined });
    }
  });
});

describe('weights', () => {
  it('stores 82.35 kg exactly (Decimal128) and round-trips', async () => {
    const id = uuid();
    const res = await a.post('/weights', { ...op(), id, measuredAt: at('2026-10-01T10:00:00Z'), timezone: tz, weightKg: '82.35' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id, weightKg: '82.35', version: 0, deltaKg: null, notes: null });
    const doc = await ctx.container.db.collection('weightEntries').findOne({ _id: id as never });
    expect(doc?.weightKg).toBeInstanceOf(Decimal128);
    expect(doc?.weightKg.toString()).toBe('82.35');
    const list = await a.get('/weights');
    expect(list.json().items.find((w: { id: string }) => w.id === id).weightKg).toBe('82.35');
  });

  it('computes delta against the chronologically previous entry (multiple per day)', async () => {
    const c = ctx.client();
    await c.signUp();
    const mk = async (iso: string, kg: string) => (await c.post('/weights', { ...op(), id: uuid(), measuredAt: at(iso), timezone: tz, weightKg: kg })).json();
    const w2 = await mk('2026-10-02T08:00:00Z', '80.1');
    const w1 = await mk('2026-10-01T08:00:00Z', '80.5'); // inserted later but earlier in time
    const w3 = await mk('2026-10-02T20:00:00Z', '79.95');
    const items = (await c.get('/weights')).json().items as { id: string; deltaKg: string | null }[];
    expect(items.map((i) => i.id)).toEqual([w3.id, w2.id, w1.id]);
    expect(items.map((i) => i.deltaKg)).toEqual(['-0.15', '-0.4', null]);

    // pagination with limit=1 still computes deltas from the real predecessor
    const p1 = (await c.get('/weights?limit=1')).json();
    expect(p1.items[0].deltaKg).toBe('-0.15');
    const p2 = (await c.get(`/weights?limit=1&cursor=${p1.nextCursor}`)).json();
    expect(p2.items[0].id).toBe(w2.id);
    expect(p2.items[0].deltaKg).toBe('-0.4');
    const p3 = (await c.get(`/weights?limit=1&cursor=${p2.nextCursor}`)).json();
    expect(p3.items[0].id).toBe(w1.id);
    expect(p3.nextCursor).toBeNull();

    // deleting the middle entry recomputes the successor's delta
    const del = await c.del(`/weights/${w2.id}`, { ...op(), expectedVersion: 0 });
    expect(del.statusCode).toBe(204);
    const after = (await c.get('/weights')).json().items as { id: string; deltaKg: string | null }[];
    expect(after.map((i) => i.deltaKg)).toEqual(['-0.55', null]);

    // from/to filter
    const ranged = (await c.get(`/weights?from=${encodeURIComponent('2026-10-02T00:00:00Z')}`)).json();
    expect(ranged.items.map((i: { id: string }) => i.id)).toEqual([w3.id]);
    expect(ranged.items[0].deltaKg).toBe('-0.55');
  });

  it('rejects future measuredAt and invalid precision', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const r1 = await a.post('/weights', { ...op(), id: uuid(), measuredAt: future, timezone: tz, weightKg: '80' });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().fieldErrors.measuredAt).toBeDefined();
    const r2 = await a.post('/weights', { ...op(), id: uuid(), measuredAt: at('2026-01-01T00:00:00Z'), timezone: tz, weightKg: '80.123' });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().code).toBe('VALIDATION_ERROR');
  });

  it('idempotent replay returns the same response without duplicating; different payload → 409', async () => {
    const body = { ...op(), id: uuid(), measuredAt: at('2026-09-01T10:00:00Z'), timezone: tz, weightKg: '70.5' };
    const r1 = await a.post('/weights', body);
    const r2 = await a.post('/weights', body);
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r2.json()).toEqual(r1.json());
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(await ctx.container.db.collection('weightEntries').countDocuments({ _id: body.id as never })).toBe(1);
    expect(await ctx.container.db.collection('idempotencyKeys').countDocuments({ operationId: body.operationId })).toBe(1);

    const r3 = await a.post('/weights', { ...body, weightKg: '71' });
    expect(r3.statusCode).toBe(409);
    expect(r3.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('concurrent duplicate requests create a single record', async () => {
    const body = { ...op(), id: uuid(), measuredAt: at('2026-09-02T10:00:00Z'), timezone: tz, weightKg: '70.4' };
    const results = await Promise.all([a.post('/weights', body), a.post('/weights', body), a.post('/weights', body)]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 201, 201]);
    expect(await ctx.container.db.collection('weightEntries').countDocuments({ _id: body.id as never })).toBe(1);
  });

  it('version conflict returns 409 with current', async () => {
    const id = uuid();
    await a.post('/weights', { ...op(), id, measuredAt: at('2026-08-01T10:00:00Z'), timezone: tz, weightKg: '75' });
    const u1 = await a.patch(`/weights/${id}`, { ...op(), expectedVersion: 0, weightKg: '75.5', notes: 'após caminhada' });
    expect(u1.statusCode).toBe(200);
    expect(u1.json()).toMatchObject({ version: 1, weightKg: '75.5', notes: 'após caminhada' });
    const u2 = await a.patch(`/weights/${id}`, { ...op(), expectedVersion: 0, weightKg: '76' });
    expect(u2.statusCode).toBe(409);
    expect(u2.json().code).toBe('VERSION_CONFLICT');
    expect(u2.json().current).toMatchObject({ id, version: 1, weightKg: '75.5' });
  });

  it('weight goal: one active per user, put/get/delete', async () => {
    const c = ctx.client();
    await c.signUp();
    expect((await c.get('/weight-goal')).statusCode).toBe(404);
    expect((await c.put('/weight-goal', { ...op(), targetKg: '72.5' })).json()).toMatchObject({ targetKg: '72.5', version: 0 });
    expect((await c.put('/weight-goal', { ...op(), targetKg: '71' })).json()).toMatchObject({ targetKg: '71', version: 1 });
    expect(await ctx.container.db.collection('weightGoals').countDocuments({ userId: c.userId, active: true })).toBe(1);
    expect((await c.del('/weight-goal', op())).statusCode).toBe(204);
    expect((await c.get('/weight-goal')).statusCode).toBe(404);
    expect((await c.put('/weight-goal', { ...op(), targetKg: '70' })).json()).toMatchObject({ targetKg: '70', version: 0 });
  });
});

describe('measurements', () => {
  it('accepts a waist-only session; absent types stay absent', async () => {
    const id = uuid();
    const res = await a.post('/measurements', { ...op(), id, measuredAt: at('2026-10-01T09:00:00Z'), timezone: tz, values: [{ type: 'waist', side: 'unspecified', valueCm: '80.5' }] });
    expect(res.statusCode).toBe(201);
    expect(res.json().values).toEqual([{ type: 'waist', side: 'unspecified', valueCm: '80.5' }]);
    const doc = await ctx.container.db.collection('measurementSessions').findOne({ _id: id as never });
    expect(doc?.values).toHaveLength(1);
  });

  it('allows sides only for arm/thigh and rejects duplicates', async () => {
    const base = { measuredAt: at('2026-10-01T09:00:00Z'), timezone: tz };
    const ok = await a.post('/measurements', { ...op(), id: uuid(), ...base, values: [{ type: 'arm', side: 'left', valueCm: '30' }, { type: 'arm', side: 'right', valueCm: '30.5' }] });
    expect(ok.statusCode).toBe(201);
    const bad = await a.post('/measurements', { ...op(), id: uuid(), ...base, values: [{ type: 'waist', side: 'left', valueCm: '80' }] });
    expect(bad.statusCode).toBe(400);
    const dup = await a.post('/measurements', { ...op(), id: uuid(), ...base, values: [{ type: 'hip', side: 'unspecified', valueCm: '90' }, { type: 'hip', side: 'unspecified', valueCm: '91' }] });
    expect(dup.statusCode).toBe(400);
    const empty = await a.post('/measurements', { ...op(), id: uuid(), ...base, values: [] });
    expect(empty.statusCode).toBe(400);
  });
});

describe('blood pressure', () => {
  it('accepts null pulse', async () => {
    const res = await a.post('/blood-pressure', { ...op(), id: uuid(), measuredAt: at('2026-10-01T07:00:00Z'), timezone: tz, systolic: 120, diastolic: 80, pulseBpm: null });
    expect(res.statusCode).toBe(201);
    expect(res.json().pulseBpm).toBeNull();
  });

  it('diastolic >= systolic requires confirmation', async () => {
    const body = { id: uuid(), measuredAt: at('2026-10-01T07:30:00Z'), timezone: tz, systolic: 80, diastolic: 90, pulseBpm: 70 };
    const r1 = await a.post('/blood-pressure', { ...op(), ...body });
    expect(r1.statusCode).toBe(422);
    expect(r1.json().code).toBe('CONFIRMATION_REQUIRED');
    const r2 = await a.post('/blood-pressure', { ...op(), ...body, confirmedUnusual: true });
    expect(r2.statusCode).toBe(201);
  });
});

describe('isolation between accounts', () => {
  it('B cannot read, edit, delete or sync A records', async () => {
    const id = uuid();
    await a.post('/blood-pressure', { ...op(), id, measuredAt: at('2026-10-02T07:00:00Z'), timezone: tz, systolic: 118, diastolic: 76, pulseBpm: 60 });
    const wid = uuid();
    await a.post('/weights', { ...op(), id: wid, measuredAt: at('2026-10-02T07:00:00Z'), timezone: tz, weightKg: '81' });

    expect((await b.get('/blood-pressure')).json().items.find((i: { id: string }) => i.id === id)).toBeUndefined();
    expect((await b.patch(`/blood-pressure/${id}`, { ...op(), expectedVersion: 0, systolic: 200 })).statusCode).toBe(404);
    expect((await b.del(`/blood-pressure/${id}`, { ...op(), expectedVersion: 0 })).statusCode).toBe(404);
    expect((await b.patch(`/weights/${wid}`, { ...op(), expectedVersion: 0, weightKg: '1' })).statusCode).toBe(404);
    // B reusing A's id for a create cannot overwrite or reveal it
    const steal = await b.post('/weights', { ...op(), id: wid, measuredAt: at('2026-10-02T07:00:00Z'), timezone: tz, weightKg: '50' });
    expect(steal.statusCode).toBe(409);
    expect(steal.json().current).toBeUndefined();
    // payload userId is ignored
    const sneaky = await b.post('/weights', { ...op(), id: uuid(), userId: a.userId, measuredAt: at('2026-10-02T07:00:00Z'), timezone: tz, weightKg: '60' });
    expect(sneaky.statusCode).toBe(201);
    const doc = await ctx.container.db.collection('weightEntries').findOne({ _id: sneaky.json().id });
    expect(doc?.userId).toBe(b.userId);

    // sync: bootstrap / changes / operations
    const boot = (await b.get('/sync/bootstrap')).json();
    expect(boot.bloodPressureEntries.find((i: { id: string }) => i.id === id)).toBeUndefined();
    expect(boot.weightEntries.find((i: { id: string }) => i.id === wid)).toBeUndefined();
    const changes = (await b.get(`/sync/changes?cursor=${Buffer.from('seq:0').toString('base64url')}`)).json();
    expect(changes.changes.find((c: { id: string }) => c.id === id || c.id === wid)).toBeUndefined();
    const ops = await b.post('/sync/operations', { operations: [{ type: 'bloodPressure.delete', entityId: id, payload: { ...op(), expectedVersion: 0 } }] });
    expect(ops.json().results[0].status).toBe(404);
    expect((await a.get('/blood-pressure')).json().items.find((i: { id: string }) => i.id === id)).toBeDefined();
  });
});
