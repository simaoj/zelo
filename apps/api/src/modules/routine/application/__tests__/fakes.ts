import type { ChangeLog, Clock, IdGenerator, TxContext, UnitOfWork } from '../../../../shared/application/ports.js';
import type { IntakeRecord } from '../../domain/entities/intake-record.js';
import type { Occurrence } from '../../domain/entities/occurrence.js';
import type { RoutineItem } from '../../domain/entities/routine-item.js';
import type { ScheduleVersion } from '../../domain/entities/schedule-version.js';
import type { RoutineAppDeps } from '../deps.js';
import type { IntakePageQuery, IntakeRepository, NewOccurrence, OccurrenceRepository, RoutineRepository } from '../ports/out/repositories.js';

const clone = <T>(v: T): T => structuredClone(v);
export const TX = {} as TxContext;

export class FakeClock implements Clock {
  constructor(public current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(iso: string) {
    this.current = new Date(iso);
  }
}

export class SeqIds implements IdGenerator {
  private n = 0;
  next() {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export class FakeRoutines implements RoutineRepository {
  items = new Map<string, RoutineItem>();
  versions = new Map<string, ScheduleVersion>();
  async insertItem(i: RoutineItem) {
    this.items.set(i.id, clone(i));
  }
  async getItem(userId: string, id: string) {
    const i = this.items.get(id);
    return i && i.userId === userId ? clone(i) : null;
  }
  async itemIdExists(id: string) {
    return this.items.has(id);
  }
  async listItems(userId: string, includeArchived: boolean) {
    return [...this.items.values()].filter((i) => i.userId === userId && (includeArchived || !i.archivedAt)).map(clone);
  }
  async updateItem(i: RoutineItem, expected: number) {
    const cur = this.items.get(i.id);
    if (!cur || cur.userId !== i.userId || cur.version !== expected) return false;
    this.items.set(i.id, clone(i));
    return true;
  }
  async insertVersion(v: ScheduleVersion) {
    this.versions.set(v.id, clone(v));
  }
  async closeVersion(userId: string, id: string, until: Date) {
    const v = this.versions.get(id);
    if (v && v.userId === userId && !v.effectiveUntil) v.effectiveUntil = until;
  }
  async getVersion(userId: string, id: string) {
    const v = this.versions.get(id);
    return v && v.userId === userId ? clone(v) : null;
  }
  async getVersions(userId: string, ids: string[]) {
    return ids.map((id) => this.versions.get(id)).filter((v): v is ScheduleVersion => !!v && v.userId === userId).map(clone);
  }
  async listGeneratableVersions(userId: string, from: Date, to: Date) {
    return [...this.versions.values()]
      .filter((v) => v.userId === userId && v.frequency !== 'none' && v.coverageFrom < to && (!v.effectiveUntil || v.effectiveUntil > from))
      .map(clone);
  }
  async listUsersWithOpenVersions() {
    return [...new Set([...this.versions.values()].filter((v) => !v.effectiveUntil && v.frequency !== 'none').map((v) => v.userId))];
  }
}

export class FakeOccurrences implements OccurrenceRepository {
  rows = new Map<string, Occurrence>();
  async upsertSlots(occs: NewOccurrence[], now: Date) {
    const created: string[] = [];
    for (const o of occs) {
      const exists = [...this.rows.values()].some(
        (r) => r.scheduleVersionId === o.scheduleVersionId && r.localDate === o.localDate && r.localTime === o.localTime,
      );
      if (exists) continue;
      this.rows.set(o.id, { ...clone(o), cancelledAt: null, version: 0, createdAt: now, updatedAt: now });
      created.push(o.id);
    }
    return created;
  }
  async getById(userId: string, id: string) {
    const o = this.rows.get(id);
    return o && o.userId === userId ? clone(o) : null;
  }
  async listLiveInRange(userId: string, from: Date, to: Date) {
    return [...this.rows.values()]
      .filter((o) => o.userId === userId && !o.cancelledAt && o.scheduledAt >= from && o.scheduledAt < to)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
      .map(clone);
  }
  async listLiveFrom(userId: string, f: { itemId: string; scheduleVersionId?: string }, from: Date) {
    return [...this.rows.values()]
      .filter((o) => o.userId === userId && o.itemId === f.itemId && (!f.scheduleVersionId || o.scheduleVersionId === f.scheduleVersionId) && !o.cancelledAt && o.scheduledAt >= from)
      .map(clone);
  }
  async cancel(userId: string, ids: string[], at: Date) {
    for (const id of ids) {
      const o = this.rows.get(id);
      if (o && o.userId === userId && !o.cancelledAt) Object.assign(o, { cancelledAt: at, updatedAt: at, version: o.version + 1 });
    }
  }
  async updateSnapshots(userId: string, ids: string[], p: { nameSnapshot: string; itemType: Occurrence['itemType'] }, at: Date) {
    for (const id of ids) {
      const o = this.rows.get(id);
      if (o && o.userId === userId) Object.assign(o, p, { updatedAt: at, version: o.version + 1 });
    }
  }
}

export class FakeIntakes implements IntakeRepository {
  rows = new Map<string, IntakeRecord>();
  async insert(r: IntakeRecord) {
    if (this.rows.has(r.id)) throw new Error('duplicate _id');
    if (r.occurrenceId && [...this.rows.values()].some((x) => x.occurrenceId === r.occurrenceId && !x.deletedAt)) throw new Error('E11000 occurrenceId');
    this.rows.set(r.id, clone(r));
  }
  async getById(userId: string, id: string) {
    const r = this.rows.get(id);
    return r && r.userId === userId ? clone(r) : null;
  }
  async idExists(id: string) {
    return this.rows.has(id);
  }
  async getLiveByOccurrence(userId: string, occurrenceId: string) {
    const r = [...this.rows.values()].find((x) => x.userId === userId && x.occurrenceId === occurrenceId && !x.deletedAt);
    return r ? clone(r) : null;
  }
  async listLiveByOccurrenceIds(userId: string, ids: string[]) {
    return [...this.rows.values()].filter((x) => x.userId === userId && x.occurrenceId && ids.includes(x.occurrenceId) && !x.deletedAt).map(clone);
  }
  async update(r: IntakeRecord, expected: number) {
    const cur = this.rows.get(r.id);
    if (!cur || cur.userId !== r.userId || cur.version !== expected) return false;
    this.rows.set(r.id, clone(r));
    return true;
  }
  async page(userId: string, q: IntakePageQuery) {
    return [...this.rows.values()]
      .filter((x) => x.userId === userId && !x.deletedAt && (!q.itemId || x.itemId === q.itemId))
      .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || (a.id < b.id ? 1 : -1))
      .filter((x) => !q.cursor || x.sortAt < q.cursor.sortAt || (x.sortAt.getTime() === q.cursor.sortAt.getTime() && x.id < q.cursor.id))
      .slice(0, q.limit)
      .map(clone);
  }
  async listLive(userId: string) {
    return [...this.rows.values()].filter((x) => x.userId === userId && !x.deletedAt).map(clone);
  }
}

export class RecordingChangeLog implements ChangeLog {
  entries: { userId: string; entity: string; id: string; op: string }[] = [];
  async record(_tx: TxContext, userId: string, c: { entity: string; id: string; op: 'upsert' | 'delete' }) {
    this.entries.push({ userId, ...c });
  }
}

export const passThroughUow: UnitOfWork = { run: (work) => work(TX) };

export function fakeDeps(nowIso = '2026-10-17T12:00:00Z', tz = 'America/Sao_Paulo') {
  const clock = new FakeClock(new Date(nowIso));
  const deps = {
    routines: new FakeRoutines(),
    occurrences: new FakeOccurrences(),
    intakes: new FakeIntakes(),
    clock,
    ids: new SeqIds(),
    uow: passThroughUow,
    changeLog: new RecordingChangeLog(),
    profiles: { getTimezone: async () => tz },
  } satisfies RoutineAppDeps;
  return deps;
}
