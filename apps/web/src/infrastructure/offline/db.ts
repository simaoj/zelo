/**
 * Per-account IndexedDB (`zelo-<userId>`). IndexedDB is a working cache + local queue;
 * MongoDB stays the source of truth. Schema versions are additive (non-destructive):
 * NEVER change/remove an existing version block — add a new `this.version(n)` instead.
 */
import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  ApiError,
  BloodPressureEntry,
  IntakeRecord,
  MeasurementSession,
  Occurrence,
  Profile,
  RoutineItem,
  SyncOperationType,
  WeightEntry,
  WeightGoal,
} from '@zelo/contracts';

export type OperationState = 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';

export interface QueuedOperation {
  /** auto-increment: global FIFO order */
  seq?: number;
  operationId: string;
  ownerUserId: string;
  entityId: string;
  type: SyncOperationType;
  payload: Record<string, unknown> & { operationId: string; expectedVersion?: number };
  expectedVersion: number | null;
  /** true when queued on top of another unsynced op of the same entity (expectedVersion is rebased) */
  chained: boolean;
  createdAt: string;
  state: OperationState;
  attempts: number;
  lastError: ApiError | null;
  /** server representation on VERSION_CONFLICT */
  remote: unknown;
  /** local entity snapshot right after the edit (shown in the conflict center) */
  localSnapshot: unknown;
  nextAttemptAt: number | null;
}

export interface MetaRow {
  key: 'cursor' | 'lastSyncedAt' | 'forceBootstrap' | 'schema';
  value: unknown;
}

export type WeightGoalRow = WeightGoal & { key: 'current' };

/** Optional local drafts (forms may persist unsaved input here; preserved across SW updates). */
export interface DraftRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class ZeloDb extends Dexie {
  profile!: EntityTable<Profile, 'userId'>;
  weightEntries!: EntityTable<WeightEntry, 'id'>;
  weightGoal!: Table<WeightGoalRow, string>;
  measurementSessions!: EntityTable<MeasurementSession, 'id'>;
  bloodPressureEntries!: EntityTable<BloodPressureEntry, 'id'>;
  routineItems!: EntityTable<RoutineItem, 'id'>;
  occurrences!: EntityTable<Occurrence, 'id'>;
  intakeRecords!: EntityTable<IntakeRecord, 'id'>;
  operations!: Table<QueuedOperation, number>;
  meta!: Table<MetaRow, string>;
  drafts!: Table<DraftRow, string>;

  constructor(public readonly userId: string, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(dbName(userId), options);
    // v1 — initial schema
    this.version(1).stores({
      profile: 'userId',
      weightEntries: 'id, measuredAt',
      weightGoal: 'key',
      measurementSessions: 'id, measuredAt',
      bloodPressureEntries: 'id, measuredAt',
      routineItems: 'id',
      occurrences: 'id, localDate, itemId',
      intakeRecords: 'id, occurrenceId, itemId',
      operations: '++seq, &operationId, entityId, state',
      meta: 'key',
    });
    // v2 — drafts table + owner index on the queue (additive; existing rows untouched)
    this.version(2)
      .stores({
        operations: '++seq, &operationId, entityId, state, ownerUserId',
        drafts: 'key',
      })
      .upgrade(async (tx) => {
        await tx.table('operations').toCollection().modify((op: Partial<QueuedOperation>) => {
          if (op.chained === undefined) op.chained = false;
          if (op.nextAttemptAt === undefined) op.nextAttemptAt = null;
        });
      });
  }
}

export const DB_PREFIX = 'zelo-';
export const dbName = (userId: string) => `${DB_PREFIX}${userId}`;

export async function deleteUserDb(userId: string) {
  await Dexie.delete(dbName(userId));
}
