import type { LightMyRequestResponse } from 'fastify';
import { Collection } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HEALTH_IMPORT_MAX_BYTES } from '@zelo/contracts';
import { FixedClock } from '../../../shared/adapters/system-clock.js';
import { createTestContext, op, type TestClient, type TestContext } from '../../../test-support/app.js';
import { fixture } from './fixtures.js';

// 2026-10-18 15:00 in São Paulo (-03:00)
const clock = new FixedClock(new Date('2026-10-18T18:00:00.000Z'));
let ctx: TestContext;
let a: TestClient;
let b: TestClient;
let tokenA: string;
let tokenB: string;
const WORKOUT_EXT = '706e08a9-66a1-4820-83dd-f7c6e314ff66';

beforeAll(async () => {
  ctx = await createTestContext({ clock });
  a = ctx.client();
  b = ctx.client();
  const ua = await a.signUp();
  const ub = await b.signUp();
  tokenA = (await ctx.container.integrationTokens.create.execute({ email: ua.email })).token;
  tokenB = (await ctx.container.integrationTokens.create.execute({ email: ub.email.toUpperCase(), label: 'Watch' })).token;
});
afterAll(async () => {
  await ctx?.close();
});

function send(body: unknown, token: string | null = tokenA, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/imports/health',
    headers: { 'content-type': 'application/json', ...(token !== null ? { authorization: `Bearer ${token}` } : {}), ...headers },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const steps = (localDateTime: string, qty: number) => ({ data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: localDateTime, qty }] }] } });
const col = (name: string) => ctx.container.db.collection(name);

describe('POST /imports/health — authentication', () => {
  it('401 without, with malformed, unknown or revoked token; session cookie alone is not accepted', async () => {
    const body = fixture('steps');
    expect((await send(body, null)).statusCode).toBe(401);
    expect((await send(body, 'zelo_hae_not-a-real-token')).statusCode).toBe(401);
    expect((await send(body, 'garbage')).statusCode).toBe(401);
    const basic = await ctx.app.inject({ method: 'POST', url: '/api/v1/imports/health', headers: { 'content-type': 'application/json', authorization: `Basic ${tokenA}` }, payload: JSON.stringify(body) });
    expect(basic.statusCode).toBe(401);
    // a signed-in browser (cookie + CSRF) still needs the bearer token
    const viaSession = await a.post('/imports/health', body);
    expect(viaSession.statusCode).toBe(401);
    expect(viaSession.json()).toMatchObject({ code: 'UNAUTHENTICATED' });

    const { token, credential } = await ctx.container.integrationTokens.create.execute({ email: (await a.get('/auth/session')).json().user.email, label: 'temp' });
    expect(token).toMatch(/^zelo_hae_[A-Za-z0-9_-]{43}$/);
    expect((await send({ data: {} }, token)).statusCode).toBe(200);
    // only the hash is stored
    const stored = await col('integrationCredentials').findOne({ _id: credential.id as never });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.lastUsedAt).toBeInstanceOf(Date);

    await ctx.container.integrationTokens.revoke.execute({ id: credential.id });
    const revoked = await send({ data: {} }, token);
    expect(revoked.statusCode).toBe(401);
    expect(revoked.body).not.toContain(token);
    const list = await ctx.container.integrationTokens.list.execute({ email: (await a.get('/auth/session')).json().user.email });
    expect(list.find((c) => c.id === credential.id)?.revokedAt).not.toBeNull();
    expect(JSON.stringify(list)).not.toMatch(/tokenHash|zelo_hae_/);
  });

  it('needs no CSRF header and ignores session cookies', async () => {
    const r = await send({ data: {} }, tokenA, { cookie: 'zelo_session=whatever' });
    expect(r.statusCode).toBe(200);
  });
});

describe('POST /imports/health — limits and validation', () => {
  it('413 above HEALTH_IMPORT_MAX_BYTES (ApiError shape)', async () => {
    const big = JSON.stringify({ data: { metrics: [], pad: 'x'.repeat(HEALTH_IMPORT_MAX_BYTES) } });
    const r = await send(big);
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ code: 'VALIDATION_ERROR', correlationId: expect.any(String) });
  });

  it('accepts bodies above the global 512 KB limit (but below 5 MB)', async () => {
    const r = await send(JSON.stringify({ data: { metrics: [], pad: 'x'.repeat(1024 * 1024) } }));
    expect(r.statusCode).toBe(200);
  });

  it('400 invalid structure with field paths; 422 for non-daily data; nothing written', async () => {
    const before = await col('dailySteps').countDocuments();
    const bad = await send({ data: { workouts: [{ name: 'Running' }] } });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().fieldErrors)).toEqual(expect.arrayContaining(['data.workouts.0.id', 'data.workouts.0.start']));
    const nonInt = await send(steps('2026-10-10 00:00:00 -0300', 10.5));
    expect(nonInt.statusCode).toBe(400);
    const dup = fixture('combined');
    dup.data.metrics![0]!.data = [
      { date: '2026-10-10 00:00:00 -0300', qty: 100 },
      { date: '2026-10-10 00:00:00 -0300', qty: 200 },
    ];
    const r = await send(dup);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe('VALIDATION_ERROR');
    expect(await col('dailySteps').countDocuments()).toBe(before);
    expect(await col('workouts').countDocuments({ externalId: WORKOUT_EXT })).toBe(0); // workouts of the rejected batch were not written either
    expect((await send('{"data":', tokenA)).statusCode).toBe(400);
    const text = await ctx.app.inject({ method: 'POST', url: '/api/v1/imports/health', headers: { 'content-type': 'text/plain', authorization: `Bearer ${tokenA}` }, payload: 'hello' });
    expect(text.statusCode).toBe(415);
  });
});

describe('POST /imports/health — persistence', () => {
  it('inserts, then resend → unchanged; 6842 → 7100 → 5000 replaces (never sums)', async () => {
    const first = await send(fixture('combined'));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ status: 'ok', steps: { inserted: 2, updated: 0, unchanged: 0 }, workouts: { inserted: 1, updated: 0, unchanged: 0 } });

    clock.advance(60_000);
    const again = await send(fixture('combined'));
    expect(again.json()).toEqual({ status: 'ok', steps: { inserted: 0, updated: 0, unchanged: 2 }, workouts: { inserted: 0, updated: 0, unchanged: 1 } });
    const userA = a.userId!;
    expect(await col('dailySteps').countDocuments({ userId: userA })).toBe(2);
    expect(await col('workouts').countDocuments({ userId: userA })).toBe(1);
    // receivedAt = last received, even when unchanged
    const doc = await col('dailySteps').findOne({ userId: userA, localDate: '2026-10-18' });
    expect(doc?.receivedAt).toEqual(clock.now());
    expect(doc?.createdAt.getTime()).toBeLessThan(clock.now().getTime());

    expect((await send(steps('2026-10-18 00:00:00 -0300', 7100))).json().steps).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect((await send(steps('2026-10-18 00:00:00 -0300', 5000))).json().steps).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    const after = await col('dailySteps').findOne({ userId: userA, localDate: '2026-10-18' });
    expect(after?.count).toBe(5000);
    expect(after?._id).toBe(doc?._id); // same record, same contract id
    // the absent day (2026-10-17) was not deleted
    expect(await col('dailySteps').countDocuments({ userId: userA })).toBe(2);
    // workout steps are never mixed into daily totals; no unrelated fields persisted
    const w = await col('workouts').findOne({ userId: userA });
    expect(Object.keys(w!).sort()).toEqual(
      ['_id', 'activeEnergyKcal', 'createdAt', 'distanceMeters', 'durationSeconds', 'endedAt', 'externalId', 'localDate', 'name', 'provider', 'receivedAt', 'startOffsetMinutes', 'startedAt', 'userId'].sort(),
    );
  });

  it('workout update by exported id (last received wins); calories/distance are not identity', async () => {
    const body = fixture('workout-v2');
    Object.assign(body.data.workouts![0]!, { duration: 1750, distance: { qty: 2.61, units: 'mi' }, activeEnergyBurned: { qty: 1300, units: 'kJ' } });
    const r = await send(body);
    expect(r.json().workouts).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    const list = (await a.get('/activity/workouts')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ name: 'Running', durationSeconds: 1750, distanceMeters: 4200.39, activeEnergyKcal: 310.71, provider: 'health-auto-export' });
    expect(list.availableNames).toEqual(['Running']);
  });

  it('user isolation: token decides the user; B cannot read A’s workouts', async () => {
    const withUserId = { ...fixture('workout-v2'), userId: b.userId };
    await send(withUserId, tokenA);
    expect(await col('workouts').countDocuments({ userId: b.userId })).toBe(0);
    const id = (await a.get('/activity/workouts')).json().items[0].id;
    expect((await a.get(`/activity/workouts/${id}`)).statusCode).toBe(200);
    expect((await b.get(`/activity/workouts/${id}`)).statusCode).toBe(404);
    expect((await b.get('/activity/workouts')).json()).toEqual({ items: [], nextCursor: null, availableNames: [] });

    // the same exported id under B is a separate record
    expect((await send(fixture('workout-v2'), tokenB)).json().workouts.inserted).toBe(1);
    expect(await col('workouts').countDocuments({ externalId: WORKOUT_EXT })).toBe(2);
  });

  it('concurrent identical imports: all 200, no duplicates, counters consistent', async () => {
    const body = { data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: '2026-10-01 00:00:00 -0300', qty: 1234 }, { date: '2026-10-02 00:00:00 -0300', qty: 4321 }] }], workouts: [{ ...fixture('workout-v2').data.workouts![0], id: 'concurrent-1', start: '2026-10-01 07:00:00 -0300', end: '2026-10-01 07:30:00 -0300' }] } };
    const results = await Promise.all(Array.from({ length: 5 }, () => send(body)));
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const json = results.map((r) => r.json());
    expect(json.reduce((s, j) => s + j.steps.inserted, 0)).toBe(2);
    expect(json.reduce((s, j) => s + j.workouts.inserted, 0)).toBe(1);
    expect(json.reduce((s, j) => s + j.steps.unchanged, 0)).toBe(8);
    expect(await col('dailySteps').countDocuments({ userId: a.userId, localDate: { $in: ['2026-10-01', '2026-10-02'] } })).toBe(2);
    expect(await col('workouts').countDocuments({ userId: a.userId, externalId: 'concurrent-1' })).toBe(1);
  });

  it('DB failure mid-batch → 500, nothing half-written; resend → correct state', async () => {
    const body = { data: { metrics: [{ name: 'step_count', units: 'count', data: [{ date: '2026-09-01 00:00:00 -0300', qty: 1 }, { date: '2026-09-02 00:00:00 -0300', qty: 2 }, { date: '2026-09-03 00:00:00 -0300', qty: 3 }] }] } };
    // failing persistence adapter: the first dailySteps upsert succeeds, the second one throws
    const real = Collection.prototype.findOneAndUpdate;
    let calls = 0;
    const spy = vi.spyOn(Collection.prototype, 'findOneAndUpdate').mockImplementation(function (this: Collection, ...args: unknown[]) {
      if (this.collectionName === 'dailySteps' && ++calls === 2) return Promise.reject(new Error('simulated: connection reset')) as never;
      return (real as (...a: unknown[]) => unknown).apply(this, args) as never;
    });
    let failed: LightMyRequestResponse;
    try {
      failed = await send(body);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await col('dailySteps').countDocuments({ userId: a.userId, localDate: { $gte: '2026-09-01', $lte: '2026-09-03' } })).toBe(0);

    const ok = await send(body);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().steps).toEqual({ inserted: 3, updated: 0, unchanged: 0 });
    expect((await send(body)).json().steps).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
  });
});

describe('activity reads', () => {
  it('GET /activity/steps: null for no data, 0 kept, partial today, average over days with data', async () => {
    await send(steps('2026-10-15 00:00:00 -0300', 0));
    const r = await a.get('/activity/steps?from=2026-10-14&to=2026-10-18');
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.days.map((d: { date: string; count: number | null; partial: boolean }) => [d.date, d.count, d.partial])).toEqual([
      ['2026-10-14', null, false],
      ['2026-10-15', 0, false],
      ['2026-10-16', null, false],
      ['2026-10-17', 9120, false],
      ['2026-10-18', 5000, true],
    ]);
    expect(s.averageOnDaysWithData).toBe(Math.round((0 + 9120 + 5000) / 3));
    expect(s.lastReceivedAt).toBe(clock.now().toISOString());
    expect(s.goal).toBeNull();
    expect((await a.get('/activity/steps?from=2026-10-18&to=2026-10-14')).statusCode).toBe(400);
    expect((await a.get('/activity/steps?from=2025-01-01&to=2026-10-18')).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/activity/steps?from=2026-10-14&to=2026-10-18' })).statusCode).toBe(401);
  });

  it('steps goal: PUT (idempotent) / GET / DELETE', async () => {
    expect((await a.get('/activity/goal')).statusCode).toBe(404);
    const put = { ...op(), dailyStepsTarget: 8000 };
    const r1 = await a.put('/activity/goal', put);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ dailyStepsTarget: 8000, version: 0 });
    const r2 = await a.put('/activity/goal', put);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect((await a.put('/activity/goal', { ...op(), dailyStepsTarget: 9000 })).json()).toMatchObject({ dailyStepsTarget: 9000, version: 1 });
    expect((await a.put('/activity/goal', { ...op(), dailyStepsTarget: 0 })).statusCode).toBe(400);
    expect((await a.get('/activity/steps?from=2026-10-18&to=2026-10-18')).json().goal).toMatchObject({ dailyStepsTarget: 9000 });
    expect((await b.get('/activity/goal')).statusCode).toBe(404);
    expect((await a.del('/activity/goal', op())).statusCode).toBe(204);
    expect((await a.get('/activity/goal')).statusCode).toBe(404);
    await a.put('/activity/goal', { ...op(), dailyStepsTarget: 10000 });
  });

  it('GET /activity/workouts filters by period and exact name; cursor pagination', async () => {
    const workouts = ['Walking', 'Cycling', 'Walking'].map((name, i) => ({
      id: `page-${i}`,
      name,
      start: `2026-10-0${5 + i} 18:00:00 -0300`,
      end: `2026-10-0${5 + i} 18:20:00 -0300`,
      duration: 1200,
    }));
    expect((await send({ data: { workouts } })).statusCode).toBe(200);
    const walking = (await a.get('/activity/workouts?name=Walking')).json();
    expect(walking.items.map((w: { localDate: string }) => w.localDate)).toEqual(['2026-10-07', '2026-10-05']);
    expect(walking.availableNames).toEqual(['Cycling', 'Running', 'Walking']);
    const period = (await a.get('/activity/workouts?from=2026-10-05&to=2026-10-06')).json();
    expect(period.items.map((w: { name: string }) => w.name)).toEqual(['Cycling', 'Walking']);
    const p1 = (await a.get('/activity/workouts?limit=2')).json();
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = (await a.get(`/activity/workouts?limit=2&cursor=${p1.nextCursor}`)).json();
    const all = [...p1.items, ...p2.items].map((w: { id: string }) => w.id);
    expect(new Set(all).size).toBe(all.length);
    expect((await a.get('/activity/workouts?cursor=nope')).statusCode).toBe(400);
  });

  it('GET /activity/today and /dashboard include activity and hydration', async () => {
    const today = (await a.get('/activity/today')).json();
    expect(today).toMatchObject({ date: '2026-10-18', steps: { count: 5000, partial: true }, stepsGoal: { dailyStepsTarget: 10000 }, workoutCount: 1, workoutSeconds: 1800 });
    const dash = await a.get('/dashboard?date=2026-10-18');
    expect(dash.statusCode).toBe(200);
    expect(dash.json().activity).toEqual(today);
    expect(dash.json().hydration).toMatchObject({ totalMl: null, entryCount: 0 });
    const old = (await a.get('/dashboard?date=2026-10-17')).json();
    expect(old.activity).toMatchObject({ steps: { count: 9120, partial: false }, workoutCount: 0, workoutSeconds: 0 });
    const empty = (await b.get('/dashboard?date=2026-10-17')).json();
    expect(empty.activity).toMatchObject({ steps: { count: null, partial: false }, workoutCount: 0 }); // B only has its own workout (2026-10-18)
  });
});

describe('sync', () => {
  it('bootstrap carries activity; /sync/changes delivers dailySteps and workout upserts (read-only)', async () => {
    const boot = (await a.get('/sync/bootstrap')).json();
    expect(boot.dailySteps.map((s: { localDate: string }) => s.localDate)).toEqual(expect.arrayContaining(['2026-10-17', '2026-10-18']));
    expect(boot.workouts.length).toBeGreaterThanOrEqual(4);
    expect(boot.activityGoal).toMatchObject({ dailyStepsTarget: 10000 });

    await send(steps('2026-10-18 00:00:00 -0300', 7777));
    const wb = fixture('workout-v2');
    wb.data.workouts![0]!.id = 'sync-new';
    await send(wb);
    await send(steps('2026-10-17 00:00:00 -0300', 9120)); // unchanged → no change row
    const ch = (await a.get(`/sync/changes?cursor=${boot.cursor}`)).json();
    const kinds = ch.changes.map((c: { entity: string; op: string }) => `${c.op}:${c.entity}`);
    expect(kinds.sort()).toEqual(['upsert:dailySteps', 'upsert:workout']);
    expect(ch.changes.find((c: { entity: string }) => c.entity === 'dailySteps').data).toMatchObject({ localDate: '2026-10-18', count: 7777 });
    // B sees nothing of A
    const bb = (await b.get('/sync/bootstrap')).json();
    expect(bb.workouts.every((w: { id: string }) => !boot.workouts.some((x: { id: string }) => x.id === w.id))).toBe(true);
  });
});

describe('migration: visible modules backfill', () => {
  it('adds hydration/activity once, bumps version, emits a profile change; idempotent', async () => {
    const c = ctx.client();
    await c.signUp();
    expect((await c.get('/profile')).json().visibleModules).toEqual(['body', 'bloodPressure', 'hydration', 'activity', 'routine']);
    // simulate a profile created before this increment
    await col('profiles').updateOne({ userId: c.userId } as never, { $set: { visibleModules: ['body', 'routine'] } });
    await col('migrations').deleteMany({});
    const v0 = (await c.get('/profile')).json().version;
    const boot = (await c.get('/sync/bootstrap')).json();

    expect(await ctx.container.runMigrations()).toEqual(['2026-10-18-profile-visible-hydration-activity']);
    const p = (await c.get('/profile')).json();
    expect(p.visibleModules).toEqual(['body', 'hydration', 'activity', 'routine']);
    expect(p.version).toBe(v0 + 1);
    const ch = (await c.get(`/sync/changes?cursor=${boot.cursor}`)).json();
    expect(ch.changes).toContainEqual(expect.objectContaining({ op: 'upsert', entity: 'profile', id: c.userId }));

    // second run: marker → nothing; even without the marker the work is a no-op
    expect(await ctx.container.runMigrations()).toEqual([]);
    await col('migrations').deleteMany({});
    await ctx.container.runMigrations();
    expect((await c.get('/profile')).json().version).toBe(v0 + 1);

    // a user who hides a module later keeps it hidden (marker present)
    await c.patch('/profile', { ...op(), expectedVersion: v0 + 1, visibleModules: ['body', 'routine'] });
    expect(await ctx.container.runMigrations()).toEqual([]);
    expect((await c.get('/profile')).json().visibleModules).toEqual(['body', 'routine']);
  });
});
