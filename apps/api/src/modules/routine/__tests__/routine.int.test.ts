import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Occurrence, RoutineItem } from '@zelo/contracts';
import { createTestContext, op, uuid, type TestClient, type TestContext } from '../../../test-support/app.js';

let ctx: TestContext;
let a: TestClient;
let b: TestClient;
let item: RoutineItem;
let morning: Occurrence;

const TZ = 'America/Sao_Paulo';
const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

beforeAll(async () => {
  ctx = await createTestContext();
  a = ctx.client();
  b = ctx.client();
  await a.signUp();
  await b.signUp();
  const res = await a.post('/routine-items', {
    ...op(),
    id: uuid(),
    name: 'Losartana',
    type: 'medication',
    dose: '50',
    unit: 'mg',
    instructions: null,
    schedule: { frequency: 'daily', weekdays: [], times: ['00:00', '23:59'], timezone: TZ, startDate: todaySP(), endDate: null, reminderEnabled: true },
  });
  expect(res.statusCode, res.body).toBe(201);
  item = res.json();
  const occ = await a.get(`/occurrences?date=${todaySP()}`);
  expect(occ.statusCode, occ.body).toBe(200);
  morning = (occ.json() as { items: Occurrence[] }).items.find((o) => o.localTime === '00:00')!;
  expect(morning.state).toBe('unrecorded');
}, 120_000);

afterAll(async () => ctx?.close());

const intakes = () => ctx.container.db.collection('intakeRecords');

describe('routine HTTP + Mongo', () => {
  it('lists items with current schedule; decimal stored as Decimal128', async () => {
    const res = await a.get('/routine-items');
    expect(res.json().items.map((i: RoutineItem) => i.currentSchedule?.times)).toEqual([['00:00', '23:59']]);
    const doc = await ctx.container.db.collection('routineItems').findOne({ _id: item.id as never });
    expect(doc?.currentDose?._bsontype).toBe('Decimal128');
  });

  it('idempotent intake: replaying the same operationId does not duplicate; different payload → 409', async () => {
    const body = { ...op(), intakeId: uuid(), status: 'taken', actualTakenAt: new Date().toISOString() };
    const r1 = await a.put(`/occurrences/${morning.id}/intake`, body);
    expect(r1.statusCode, r1.body).toBe(201);
    const r2 = await a.put(`/occurrences/${morning.id}/intake`, body);
    expect(r2.statusCode).toBe(201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json()).toEqual(r1.json());
    expect(await intakes().countDocuments({ occurrenceId: morning.id })).toBe(1);

    const r3 = await a.put(`/occurrences/${morning.id}/intake`, { ...body, status: 'not_taken', actualTakenAt: null });
    expect(r3.statusCode).toBe(409);
    expect(r3.json().code).toBe('IDEMPOTENCY_CONFLICT');

    // a new operation without expectedVersion cannot silently overwrite
    const r4 = await a.put(`/occurrences/${morning.id}/intake`, { ...op(), intakeId: uuid(), status: 'not_taken', actualTakenAt: null });
    expect(r4.statusCode).toBe(409);
    expect(r4.json().code).toBe('VERSION_CONFLICT');
    expect(r4.json().current.intake.status).toBe('taken');
  });

  it('partial unique index allows only one live decision per occurrence', async () => {
    const base = { userId: a.userId, itemId: item.id, occurrenceId: morning.id, status: 'not_taken', deletedAt: null };
    await expect(intakes().insertOne({ _id: uuid() as never, ...base, active: true })).rejects.toMatchObject({ code: 11000 });
    // soft-deleted history (no active marker) and ad-hoc (no occurrenceId) are fine
    const ids = [uuid(), uuid()];
    await intakes().insertOne({ _id: ids[0] as never, ...base, deletedAt: new Date() });
    await intakes().insertOne({ _id: ids[1] as never, userId: a.userId, itemId: item.id, status: 'taken', deletedAt: null });
    await intakes().deleteMany({ _id: { $in: ids as never[] } }); // raw probes, not valid records
  });

  it('undo soft-deletes, then a new decision can be recorded; same op via /sync/operations replays', async () => {
    const live = (await a.get(`/occurrences?date=${todaySP()}`)).json().items.find((o: Occurrence) => o.id === morning.id);
    const undo = await a.del(`/occurrences/${morning.id}/intake`, { ...op(), expectedVersion: live.intake.version });
    expect(undo.statusCode, undo.body).toBe(204);
    const after = (await a.get(`/occurrences?date=${todaySP()}`)).json().items.find((o: Occurrence) => o.id === morning.id);
    expect(after.state).toBe('unrecorded');
    expect(after.intake).toBeNull();

    const payload = { ...op(), intakeId: uuid(), status: 'not_taken', actualTakenAt: null };
    const s1 = await a.post('/sync/operations', { operations: [{ type: 'occurrence.intake.put', entityId: morning.id, payload }] });
    expect(s1.statusCode, s1.body).toBe(200);
    expect(s1.json().results[0].status).toBe(201);
    // retried through REST with the same operationId → replay, no duplicate
    const rest = await a.put(`/occurrences/${morning.id}/intake`, payload);
    expect(rest.statusCode).toBe(201);
    expect(rest.headers['idempotent-replayed']).toBe('true');
    expect(await intakes().countDocuments({ occurrenceId: morning.id, active: true })).toBe(1);
  });

  it('ad-hoc intake via sync does not confirm an occurrence and appears in history', async () => {
    const id = uuid();
    const res = await a.post('/sync/operations', {
      operations: [{ type: 'intake.create', entityId: id, payload: { ...op(), id, itemId: item.id, actualTakenAt: new Date(Date.now() - 60_000).toISOString(), notes: null } }],
    });
    expect(res.json().results[0].status).toBe(201);
    const hist = await a.get(`/intakes?itemId=${item.id}`);
    expect(hist.statusCode, hist.body).toBe(200);
    expect(hist.json().items.some((i: { id: string; occurrenceId: string | null }) => i.id === id && i.occurrenceId === null)).toBe(true);
  });

  it('user isolation for items, occurrences and intakes', async () => {
    expect((await b.get('/routine-items?includeArchived=true')).json().items).toEqual([]);
    expect((await b.get(`/occurrences?date=${todaySP()}`)).json().items).toEqual([]);
    const put = await b.put(`/occurrences/${morning.id}/intake`, { ...op(), intakeId: uuid(), status: 'taken', actualTakenAt: new Date().toISOString() });
    expect(put.statusCode).toBe(404);
    const patch = await b.patch(`/routine-items/${item.id}`, { ...op(), expectedVersion: 0, name: 'hack' });
    expect(patch.statusCode).toBe(404);
    expect((await b.get('/intakes')).json().items).toEqual([]);
    const boot = await b.get('/sync/bootstrap');
    expect(boot.json().occurrences).toEqual([]);
  });

  it('sync bootstrap carries routine entities; archive cancels future pending and keeps history', async () => {
    const boot = (await a.get('/sync/bootstrap')).json();
    expect(boot.routineItems).toHaveLength(1);
    expect(boot.occurrences.length).toBeGreaterThan(0);
    expect(boot.intakeRecords.length).toBeGreaterThan(0);

    const arch = await a.post(`/routine-items/${item.id}/archive`, { ...op(), expectedVersion: item.version });
    expect(arch.statusCode, arch.body).toBe(200);
    const today = (await a.get(`/occurrences?date=${todaySP()}`)).json().items as Occurrence[];
    expect(today.map((o) => o.localTime)).toEqual(['00:00']); // decided past one stays; 23:59 cancelled
    expect((await a.get('/intakes')).json().items.length).toBeGreaterThan(0);
  });
});
