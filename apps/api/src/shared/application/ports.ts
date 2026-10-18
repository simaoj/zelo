/**
 * Cross-cutting output ports shared by every module. Implementations live in
 * src/shared/adapters (MongoDB, system clock, crypto UUID) and are wired in src/bootstrap.
 * Application code depends ONLY on these interfaces.
 */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** UUID v4/v7 string */
  next(): string;
}

/**
 * Opaque transaction handle. Mongo adapters downcast it to a ClientSession
 * (see shared/adapters/mongo-unit-of-work.ts). Application code just passes it through.
 */
export interface TxContext {
  readonly __tx: unique symbol;
}

export interface UnitOfWork {
  /** Runs `work` in a MongoDB transaction (retried on transient errors). */
  run<T>(work: (tx: TxContext) => Promise<T>): Promise<T>;
}

/**
 * Per-user change log used for sync (spec §9.7/§9.8). Every mutation of a synced
 * entity MUST call `record` inside the same transaction. The adapter increments a
 * per-user counter (`syncCounters` collection, findOneAndUpdate $inc inside the tx)
 * so the sequence is gap-free per committed transaction and snapshot+cursor are consistent.
 */
export type SyncEntityName =
  | 'profile'
  | 'weightEntry'
  | 'weightGoal'
  | 'measurementSession'
  | 'bloodPressureEntry'
  | 'routineItem'
  | 'occurrence'
  | 'intakeRecord'
  | 'waterEntry'
  | 'hydrationGoal'
  | 'dailySteps'
  | 'activityGoal'
  | 'workout';

export interface ChangeLog {
  record(
    tx: TxContext,
    userId: string,
    change: { entity: SyncEntityName; id: string; op: 'upsert' | 'delete' },
  ): Promise<void>;
}

/**
 * Idempotency (spec §8). Use cases don't call this directly — the HTTP layer and the
 * sync dispatcher wrap each mutation with `IdempotentExecutor.execute`, which stores
 * {userId, operationId, requestHash, responseStatus, responseBody} in the SAME transaction
 * as the mutation.
 */
export interface IdempotentExecutor {
  execute(
    userId: string,
    operationId: string,
    requestPayload: unknown,
    work: (tx: TxContext) => Promise<{ status: number; body: unknown }>,
  ): Promise<{ status: number; body: unknown; replayed: boolean }>;
}

/** Authenticated caller identity resolved by the HTTP layer from the session cookie. */
export interface Actor {
  userId: string;
}
