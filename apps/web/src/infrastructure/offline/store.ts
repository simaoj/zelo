/**
 * Local store operations over the per-account Dexie DB: applying server entities, applying
 * remote changes (upserts + tombstones), applying LOCAL optimistic edits, queue helpers.
 */
import {
  SyncOperation,
  type BloodPressureEntry,
  type IntakeRecord,
  type MeasurementSession,
  type Occurrence,
  type RoutineItem,
  type SyncBootstrapResponse,
  type SyncChange,
  type SyncOperationType,
  type WeightEntry,
} from '@zelo/contracts';
import { DataError, OfflineError } from '@/shared/data/ports';
import type { Table } from 'dexie';
import type { QueuedOperation, ZeloDb } from './db';
import { deriveOccurrenceState, withDeltas } from './local-queries';

export const UNSYNCED_STATES = ['pending', 'syncing', 'conflict', 'error'] as const;

/** Every table that a local edit / server confirmation may touch (for Dexie transactions). */
export const dataTables = (db: ZeloDb) => [
  db.profile,
  db.weightEntries,
  db.weightGoal,
  db.measurementSessions,
  db.bloodPressureEntries,
  db.routineItems,
  db.occurrences,
  db.intakeRecords,
  db.operations,
  db.meta,
];

export function localError(status: number, code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFIRMATION_REQUIRED', message: string, fieldErrors?: Record<string, string[]>) {
  return new DataError(status, { code, message, fieldErrors, correlationId: 'local' });
}

export async function unsyncedOps(db: ZeloDb): Promise<QueuedOperation[]> {
  return db.operations.where('state').anyOf(UNSYNCED_STATES as unknown as string[]).sortBy('seq');
}

export async function entityHasUnsynced(db: ZeloDb, entityId: string): Promise<boolean> {
  const ops = await db.operations.where('entityId').equals(entityId).toArray();
  return ops.some((o) => o.state !== 'synced');
}

export async function recomputeDeltas(db: ZeloDb) {
  const all = await db.weightEntries.toArray();
  await db.weightEntries.bulkPut(withDeltas(all));
}

// ---------- server data ----------

export async function applyBootstrap(db: ZeloDb, b: SyncBootstrapResponse, keepIds: Set<string>) {
  await db.transaction('rw', dataTables(db), async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const replace = async <T extends { id: string }>(table: Table<T, string, any>, rows: T[]) => {
      const existing = await table.toArray();
      const incoming = new Set(rows.map((r) => r.id));
      await table.bulkDelete(existing.filter((e) => !incoming.has(e.id) && !keepIds.has(e.id)).map((e) => e.id));
      await table.bulkPut(rows.filter((r) => !keepIds.has(r.id)));
    };
    await db.profile.clear();
    await db.profile.put(b.profile);
    await db.weightGoal.clear();
    if (b.weightGoal) await db.weightGoal.put({ ...b.weightGoal, key: 'current' });
    await replace(db.weightEntries, b.weightEntries);
    await replace(db.measurementSessions, b.measurementSessions);
    await replace(db.bloodPressureEntries, b.bloodPressureEntries);
    await replace(db.routineItems, b.routineItems);
    await replace(db.occurrences, b.occurrences);
    await replace(
      db.intakeRecords,
      b.intakeRecords.filter((r) => !(r.occurrenceId && keepIds.has(r.occurrenceId))),
    );
    await recomputeDeltas(db);
    await db.meta.put({ key: 'cursor', value: b.cursor });
  });
}

/** Applies one remote change. Upserts of entities with unsynced local ops are skipped. */
export async function applyChange(db: ZeloDb, c: SyncChange, pendingIds: Set<string>) {
  if (c.op === 'upsert' && pendingIds.has(c.id)) return;
  const del = c.op === 'delete';
  const data = c.op === 'upsert' ? c.data : undefined;
  switch (c.entity) {
    case 'profile':
      if (del) await db.profile.clear();
      else await db.profile.put(data as never);
      return;
    case 'weightGoal':
      if (del) await db.weightGoal.clear();
      else await db.weightGoal.put({ ...(data as object), key: 'current' } as never);
      return;
    case 'weightEntry':
      if (del) await db.weightEntries.delete(c.id);
      else await db.weightEntries.put(data as WeightEntry);
      return;
    case 'measurementSession':
      if (del) await db.measurementSessions.delete(c.id);
      else await db.measurementSessions.put(data as MeasurementSession);
      return;
    case 'bloodPressureEntry':
      if (del) await db.bloodPressureEntries.delete(c.id);
      else await db.bloodPressureEntries.put(data as BloodPressureEntry);
      return;
    case 'routineItem':
      if (del) await db.routineItems.delete(c.id);
      else await db.routineItems.put(data as RoutineItem);
      return;
    case 'occurrence':
      if (del) await db.occurrences.delete(c.id);
      else await db.occurrences.put(data as Occurrence);
      return;
    case 'intakeRecord': {
      if (del) {
        const rec = await db.intakeRecords.get(c.id);
        await db.intakeRecords.delete(c.id);
        const occId = rec?.occurrenceId;
        if (occId && !pendingIds.has(occId)) {
          const occ = await db.occurrences.get(occId);
          if (occ?.intake?.id === c.id) await db.occurrences.put({ ...occ, intake: null });
        }
        return;
      }
      const rec = data as IntakeRecord;
      if (rec.occurrenceId && pendingIds.has(rec.occurrenceId)) return;
      await db.intakeRecords.put(rec);
      if (rec.occurrenceId) {
        const occ = await db.occurrences.get(rec.occurrenceId);
        if (occ && (!occ.intake || occ.intake.version <= rec.version)) await db.occurrences.put({ ...occ, intake: rec });
      }
      return;
    }
  }
}

/** Replaces the local entity with the server-confirmed representation of an operation. */
export async function applyServerResult(db: ZeloDb, type: SyncOperationType, entityId: string, body: unknown) {
  switch (type) {
    case 'weight.create':
    case 'weight.update':
      await db.weightEntries.put(body as WeightEntry);
      await recomputeDeltas(db);
      return;
    case 'weight.delete':
      await db.weightEntries.delete(entityId);
      await recomputeDeltas(db);
      return;
    case 'measurement.create':
    case 'measurement.update':
      await db.measurementSessions.put(body as MeasurementSession);
      return;
    case 'measurement.delete':
      await db.measurementSessions.delete(entityId);
      return;
    case 'bloodPressure.create':
    case 'bloodPressure.update':
      await db.bloodPressureEntries.put(body as BloodPressureEntry);
      return;
    case 'bloodPressure.delete':
      await db.bloodPressureEntries.delete(entityId);
      return;
    case 'occurrence.intake.put': {
      const rec = body as IntakeRecord;
      await db.intakeRecords.put(rec);
      const occ = await db.occurrences.get(entityId);
      if (occ) await db.occurrences.put({ ...occ, intake: rec, state: rec.status });
      return;
    }
    case 'occurrence.intake.delete': {
      const occ = await db.occurrences.get(entityId);
      if (occ) {
        if (occ.intake) await db.intakeRecords.delete(occ.intake.id);
        await db.occurrences.put({ ...occ, intake: null, state: deriveOccurrenceState({ ...occ, intake: null }, new Date()) });
      }
      return;
    }
    case 'intake.create':
      await db.intakeRecords.put(body as IntakeRecord);
      return;
  }
}

/** Applies the conflict `current` (server) representation, or removes the entity when null. */
export async function applyRemoteSnapshot(db: ZeloDb, op: QueuedOperation) {
  const remote = op.remote;
  if (op.type.startsWith('occurrence.intake')) {
    const occ = await db.occurrences.get(op.entityId);
    if (!occ) return;
    const rec = (remote as IntakeRecord | null) ?? null;
    if (occ.intake && (!rec || rec.id !== occ.intake.id)) await db.intakeRecords.delete(occ.intake.id);
    if (rec) await db.intakeRecords.put(rec);
    await db.occurrences.put({ ...occ, intake: rec });
    return;
  }
  const kind = op.type.split('.')[0];
  const table = kind === 'weight' ? db.weightEntries : kind === 'measurement' ? db.measurementSessions : kind === 'bloodPressure' ? db.bloodPressureEntries : db.intakeRecords;
  if (remote && typeof remote === 'object' && 'id' in remote) await (table as typeof db.weightEntries).put(remote as never);
  else await table.delete(op.entityId);
  if (kind === 'weight') await recomputeDeltas(db);
}

// ---------- local optimistic edits ----------

function stripMeta<T extends Record<string, unknown>>(p: T) {
  const rest: Record<string, unknown> = { ...p };
  delete rest.operationId;
  delete rest.expectedVersion;
  delete rest.confirmedUnusual;
  for (const k of Object.keys(rest)) if (rest[k] === undefined) delete rest[k];
  return rest;
}

/** Validates an operation with the shared contract (same rules the server applies). */
export function validateOperation(type: SyncOperationType, entityId: string, payload: unknown) {
  const parsed = SyncOperation.safeParse({ type, entityId, payload });
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.filter((p) => p !== 'payload').join('.') || '_';
      (fieldErrors[path] ??= []).push(issue.message);
    }
    throw localError(422, 'VALIDATION_ERROR', 'Confira os campos destacados.', fieldErrors);
  }
  const p = payload as { systolic?: number; diastolic?: number; confirmedUnusual?: boolean };
  if (type.startsWith('bloodPressure.') && p.systolic != null && p.diastolic != null && p.diastolic >= p.systolic && !p.confirmedUnusual) {
    throw localError(422, 'CONFIRMATION_REQUIRED', 'A pressão diastólica está maior ou igual à sistólica. Confira os valores.');
  }
}

/**
 * Writes the optimistic local version of an operation. Must run inside a Dexie rw transaction
 * together with the queue insert. Returns the local representation (value for the UI).
 */
export async function applyLocalEdit(db: ZeloDb, type: SyncOperationType, entityId: string, payload: Record<string, unknown>, now: Date): Promise<unknown> {
  const ts = now.toISOString();
  const kind = type.split('.')[0] as 'weight' | 'measurement' | 'bloodPressure' | 'occurrence' | 'intake';
  const action = type.split('.').pop() as 'create' | 'update' | 'delete' | 'put';

  if (kind === 'weight' || kind === 'measurement' || kind === 'bloodPressure') {
    const table = (kind === 'weight' ? db.weightEntries : kind === 'measurement' ? db.measurementSessions : db.bloodPressureEntries) as unknown as typeof db.weightEntries;
    const existing = await table.get(entityId);
    let value: unknown = null;
    if (action === 'create') {
      if (existing) value = existing; // same id → idempotent
      else {
        const base: Record<string, unknown> = { ...stripMeta(payload), id: entityId, version: 0, createdAt: ts, updatedAt: ts, notes: (payload.notes as string | null | undefined) ?? null };
        if (kind === 'weight') base.deltaKg = null;
        if (kind === 'bloodPressure') base.pulseBpm = (payload.pulseBpm as number | null | undefined) ?? null;
        await table.put(base as never);
        value = base;
      }
    } else if (action === 'update') {
      if (!existing) throw localError(404, 'NOT_FOUND', 'Registro não encontrado neste dispositivo.');
      value = { ...existing, ...stripMeta(payload), updatedAt: ts };
      await table.put(value as never);
    } else {
      if (!existing) throw localError(404, 'NOT_FOUND', 'Registro não encontrado neste dispositivo.');
      await table.delete(entityId);
    }
    if (kind === 'weight') {
      await recomputeDeltas(db);
      if (value) value = await db.weightEntries.get(entityId);
    }
    return value;
  }

  if (type === 'occurrence.intake.put' || type === 'occurrence.intake.delete') {
    const occ = await db.occurrences.get(entityId);
    if (!occ) throw new OfflineError('Esta programação não está disponível offline neste dispositivo.');
    if (type === 'occurrence.intake.delete') {
      if (occ.intake) await db.intakeRecords.delete(occ.intake.id);
      const next = { ...occ, intake: null };
      await db.occurrences.put({ ...next, state: deriveOccurrenceState(next, now) });
      return null;
    }
    const prev = occ.intake;
    const rec: IntakeRecord = {
      id: prev?.id ?? (payload.intakeId as string),
      version: prev?.version ?? 0,
      createdAt: prev?.createdAt ?? ts,
      updatedAt: ts,
      itemId: occ.itemId,
      occurrenceId: occ.id,
      status: payload.status as IntakeRecord['status'],
      sortAt: payload.status === 'taken' ? payload.actualTakenAt as string : occ.scheduledAt,
      actualTakenAt: (payload.actualTakenAt as string | null) ?? null,
      notes: payload.notes !== undefined ? (payload.notes as string | null) : (prev?.notes ?? null),
      nameSnapshot: occ.nameSnapshot,
      doseSnapshot: occ.doseSnapshot,
      unitSnapshot: occ.unitSnapshot,
    };
    await db.intakeRecords.put(rec);
    await db.occurrences.put({ ...occ, intake: rec, state: rec.status });
    return rec;
  }

  // intake.create (ad-hoc)
  const existing = await db.intakeRecords.get(entityId);
  if (existing) return existing;
  const item = await db.routineItems.get(payload.itemId as string);
  if (!item) throw new OfflineError('Este item não está disponível offline neste dispositivo.');
  const rec: IntakeRecord = {
    id: entityId,
    version: 0,
    createdAt: ts,
    updatedAt: ts,
    itemId: item.id,
    occurrenceId: null,
    status: 'taken',
    actualTakenAt: payload.actualTakenAt as string,
    notes: (payload.notes as string | null | undefined) ?? null,
    nameSnapshot: item.name,
    doseSnapshot: item.currentDose,
    unitSnapshot: item.currentUnit,
  };
  await db.intakeRecords.put(rec);
  return rec;
}

/** Current local version of the entity an operation targets (for rebasing chained ops). */
export async function currentLocalVersion(db: ZeloDb, op: QueuedOperation): Promise<number | null> {
  if (op.type.startsWith('occurrence.intake')) {
    const occ = await db.occurrences.get(op.entityId);
    return occ?.intake?.version ?? null;
  }
  const kind = op.type.split('.')[0];
  const table = kind === 'weight' ? db.weightEntries : kind === 'measurement' ? db.measurementSessions : kind === 'bloodPressure' ? db.bloodPressureEntries : db.intakeRecords;
  const e = (await (table as typeof db.weightEntries).get(op.entityId)) as { version?: number } | undefined;
  return e?.version ?? null;
}
