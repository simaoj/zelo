import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { createRoutineUseCases, type RoutineUseCases } from '../use-cases/index.js';
import { fakeDeps, TX } from './fakes.js';

const U = 'user-a';
const ITEM = '11111111-1111-4111-8111-111111111111';
const schedule = {
  frequency: 'daily' as const,
  weekdays: [],
  times: ['08:00', '20:00'],
  timezone: 'America/Sao_Paulo',
  startDate: '2026-10-10',
  endDate: null,
  reminderEnabled: true,
};

describe('routine use cases (fakes)', () => {
  let d: ReturnType<typeof fakeDeps>;
  let uc: RoutineUseCases;

  beforeEach(async () => {
    d = fakeDeps('2026-10-17T12:30:00Z'); // 09:30 in São Paulo
    uc = createRoutineUseCases(d);
    await uc.createItem.execute(U, { id: ITEM, name: 'Losartana', type: 'medication', dose: '50', unit: 'mg', schedule }, TX);
  });

  const day = async (date: string) => (await uc.listOccurrences.forDate(U, date)).items;

  it('creates the rolling window from today (no back-fill) and derives states', async () => {
    const live = [...d.occurrences.rows.values()];
    expect(live).toHaveLength(15 * 2); // today … today+14, two times
    const today = await day('2026-10-17');
    expect(today.map((o) => [o.localTime, o.state])).toEqual([
      ['08:00', 'unrecorded'],
      ['20:00', 'scheduled'],
    ]);
    expect(await day('2026-10-16')).toEqual([]);
    // generating again is idempotent
    await uc.generate.forWindow(U, [...d.routines.versions.values()], TX);
    expect(d.occurrences.rows.size).toBe(30);
  });

  it('time passing never turns unrecorded into not_taken', async () => {
    d.clock.set('2026-10-25T12:00:00Z');
    const past = await day('2026-10-17');
    expect(past.map((o) => o.state)).toEqual(['unrecorded', 'unrecorded']);
  });

  it('records, replaces (expectedVersion required) and undoes a decision', async () => {
    const [morning] = await day('2026-10-17');
    const put = await uc.putIntake(U, morning!.id, { operationId: 'x', intakeId: '22222222-2222-4222-8222-222222222222', status: 'taken', actualTakenAt: '2026-10-17T11:05:00Z' }, TX);
    expect(put.status).toBe(201);
    expect(put.body.state).toBe('taken');
    expect(put.body.intake?.nameSnapshot).toBe('Losartana');

    await expect(
      uc.putIntake(U, morning!.id, { operationId: 'y', intakeId: '33333333-3333-4333-8333-333333333333', status: 'not_taken', actualTakenAt: null }, TX),
    ).rejects.toBeInstanceOf(VersionConflictError);

    const replaced = await uc.putIntake(U, morning!.id, { operationId: 'z', intakeId: '33333333-3333-4333-8333-333333333333', status: 'not_taken', actualTakenAt: null, expectedVersion: 0 }, TX);
    expect(replaced.status).toBe(200);
    expect(replaced.body.intake?.id).toBe('22222222-2222-4222-8222-222222222222');
    expect(replaced.body.state).toBe('not_taken');

    await expect(uc.undoIntake.execute(U, morning!.id, { expectedVersion: 0 }, TX)).rejects.toBeInstanceOf(VersionConflictError);
    await uc.undoIntake.execute(U, morning!.id, { expectedVersion: 1 }, TX);
    expect((await day('2026-10-17'))[0]!.state).toBe('unrecorded');
    expect(d.intakes.rows.size).toBe(1); // soft delete keeps history
    expect(d.changeLog.entries.filter((e) => e.entity === 'intakeRecord').map((e) => e.op)).toEqual(['upsert', 'upsert', 'delete']);
  });

  it('rejects a future actual time', async () => {
    const [morning] = await day('2026-10-17');
    await expect(
      uc.putIntake(U, morning!.id, { operationId: 'x', intakeId: '22222222-2222-4222-8222-222222222222', status: 'taken', actualTakenAt: '2026-10-17T15:00:00Z' }, TX),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('user isolation: another user cannot see or decide occurrences', async () => {
    const [morning] = await day('2026-10-17');
    await expect(
      uc.putIntake('user-b', morning!.id, { operationId: 'x', intakeId: '22222222-2222-4222-8222-222222222222', status: 'not_taken', actualTakenAt: null }, TX),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await uc.listOccurrences.forDate('user-b', '2026-10-17')).toEqual({ date: '2026-10-17', items: [] });
  });

  it('revising preserves past occurrences and recorded decisions, cancels only future pending', async () => {
    const [morning, evening] = await day('2026-10-17');
    const [tomorrowMorning] = await day('2026-10-18');
    await uc.putIntake(U, morning!.id, { operationId: 'a', intakeId: '44444444-4444-4444-8444-444444444444', status: 'taken', actualTakenAt: '2026-10-17T11:00:00Z' }, TX);
    // decision on a future occurrence (e.g. user already knows they will skip it)
    await uc.putIntake(U, tomorrowMorning!.id, { operationId: 'b', intakeId: '55555555-5555-4555-8555-555555555555', status: 'not_taken', actualTakenAt: null }, TX);

    const res = await uc.reviseSchedule.execute(U, ITEM, { expectedVersion: 0, dose: '100', unit: 'mg', schedule: { ...schedule, times: ['21:00'] } }, TX);
    expect(res.body.currentDose).toBe('100');
    expect(res.body.currentSchedule?.times).toEqual(['21:00']);

    const occ = d.occurrences.rows;
    expect(occ.get(morning!.id)!.cancelledAt).toBeNull(); // past + decided
    expect(occ.get(evening!.id)!.cancelledAt).not.toBeNull(); // future pending of old version
    expect(occ.get(tomorrowMorning!.id)!.cancelledAt).toBeNull(); // decided → untouched
    expect(occ.get(morning!.id)!.doseSnapshot).toBe('50');

    const today = await day('2026-10-17');
    expect(today.map((o) => [o.localTime, o.doseSnapshot, o.state])).toEqual([
      ['08:00', '50', 'taken'],
      ['21:00', '100', 'scheduled'],
    ]);
    // intake snapshot unchanged
    expect(today[0]!.intake?.doseSnapshot).toBe('50');
    // old version closed
    const versions = [...d.routines.versions.values()];
    expect(versions.filter((v) => v.effectiveUntil === null)).toHaveLength(1);
    // stale expectedVersion
    await expect(
      uc.reviseSchedule.execute(U, ITEM, { expectedVersion: 0, dose: '1', unit: 'mg', schedule }, TX),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('archiving cancels only future pending and preserves history', async () => {
    const [morning] = await day('2026-10-17');
    await uc.putIntake(U, morning!.id, { operationId: 'a', intakeId: '44444444-4444-4444-8444-444444444444', status: 'taken', actualTakenAt: '2026-10-17T11:00:00Z' }, TX);
    const res = await uc.archiveItem.execute(U, ITEM, { expectedVersion: 0 }, TX);
    expect(res.body.archivedAt).not.toBeNull();
    const today = await day('2026-10-17');
    expect(today.map((o) => [o.localTime, o.state])).toEqual([['08:00', 'taken']]);
    expect(await day('2026-10-20')).toEqual([]);
    expect((await uc.listItems.execute(U, false))).toHaveLength(0);
    expect((await uc.listItems.execute(U, true))).toHaveLength(1);
    // history still listed
    expect((await uc.listIntakes.execute(U, {})).items).toHaveLength(1);
    // no ad-hoc on archived items; no revise
    await expect(
      uc.createAdHoc(U, { operationId: 'c', id: '66666666-6666-4666-8666-666666666666', itemId: ITEM, actualTakenAt: '2026-10-17T12:00:00Z' }, TX),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(uc.reviseSchedule.execute(U, ITEM, { expectedVersion: 1, dose: '1', unit: 'mg', schedule }, TX)).rejects.toBeInstanceOf(ValidationError);
  });

  it('ad-hoc intake never confirms an occurrence', async () => {
    const res = await uc.createAdHoc(U, { operationId: 'c', id: '66666666-6666-4666-8666-666666666666', itemId: ITEM, actualTakenAt: '2026-10-17T11:00:00Z' }, TX);
    expect(res.status).toBe(201);
    expect(res.body.occurrenceId).toBeNull();
    expect(res.body.status).toBe('taken');
    expect((await day('2026-10-17')).map((o) => o.state)).toEqual(['unrecorded', 'scheduled']);
    await expect(
      uc.createAdHoc('user-b', { operationId: 'c', id: '77777777-7777-4777-8777-777777777777', itemId: ITEM, actualTakenAt: '2026-10-17T11:00:00Z' }, TX),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renaming updates future pending occurrences only; snapshots of past/decided stay', async () => {
    const [morning] = await day('2026-10-17');
    await uc.putIntake(U, morning!.id, { operationId: 'a', intakeId: '44444444-4444-4444-8444-444444444444', status: 'taken', actualTakenAt: '2026-10-17T11:00:00Z' }, TX);
    await uc.updateItem.execute(U, ITEM, { expectedVersion: 0, name: 'Losartana potássica' }, TX);
    const today = await day('2026-10-17');
    expect(today.map((o) => o.nameSnapshot)).toEqual(['Losartana', 'Losartana potássica']);
    expect(today[0]!.intake?.nameSnapshot).toBe('Losartana');
  });

  it('intake history paginates with a stable cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await uc.createAdHoc(U, { operationId: `op${i}`, id: `88888888-8888-4888-8888-00000000000${i}`, itemId: ITEM, actualTakenAt: `2026-10-1${i}T10:00:00Z` }, TX);
    }
    const p1 = await uc.listIntakes.execute(U, { limit: 2 });
    expect(p1.items.map((i) => i.actualTakenAt)).toEqual(['2026-10-14T10:00:00.000Z', '2026-10-13T10:00:00.000Z']);
    const p2 = await uc.listIntakes.execute(U, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.actualTakenAt)).toEqual(['2026-10-12T10:00:00.000Z', '2026-10-11T10:00:00.000Z']);
    const p3 = await uc.listIntakes.execute(U, { limit: 2, cursor: p2.nextCursor! });
    expect(p3.items).toHaveLength(1);
    expect(p3.nextCursor).toBeNull();
  });

  it('weekly schedule with future start creates nothing before start', async () => {
    const id = '99999999-9999-4999-8999-999999999999';
    await uc.createItem.execute(U, { id, name: 'Vitamina D', type: 'vitamin', dose: '2', unit: 'gotas', schedule: { ...schedule, frequency: 'weekly', weekdays: [1], times: ['10:00'], startDate: '2026-10-25' } }, TX);
    const rows = [...d.occurrences.rows.values()].filter((o) => o.itemId === id);
    expect(rows.map((r) => r.localDate)).toEqual(['2026-10-26']);
  });
});
