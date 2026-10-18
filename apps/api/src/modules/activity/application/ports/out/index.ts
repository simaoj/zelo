import type { TxContext } from '../../../../../shared/application/ports.js';
import type { ActivityGoal, ActivityProvider, DailySteps, StepsValues, Workout, WorkoutValues } from '../../../domain/activity.js';

/**
 * Thrown by repositories when an upsert hits the unique index because a concurrent request
 * inserted the same natural key first. The use case retries the whole batch once.
 */
export class ConcurrentUpsertError extends Error {
  constructor() {
    super('concurrent upsert on the same natural key');
  }
}

export interface UpsertResult<T> {
  /** state before the write (null → inserted) */
  before: T | null;
  /** id of the stored record (existing id, or `newId` when inserted) */
  id: string;
}

export interface DailyStepsRepository {
  /**
   * Upsert by (userId, provider, localDate): `$set` count/offsetMinutes/receivedAt,
   * `$setOnInsert` id/createdAt. Never `$inc`. Throws ConcurrentUpsertError on duplicate key.
   */
  upsert(userId: string, provider: ActivityProvider, v: StepsValues, receivedAt: Date, newId: string, tx: TxContext): Promise<UpsertResult<DailySteps>>;
  findById(userId: string, id: string, tx?: TxContext): Promise<DailySteps | null>;
  /** inclusive local-date range */
  listRange(userId: string, from: string, to: string, tx?: TxContext): Promise<DailySteps[]>;
  findByDate(userId: string, localDate: string, tx?: TxContext): Promise<DailySteps | null>;
  lastReceivedAt(userId: string): Promise<Date | null>;
}

export interface WorkoutPosition {
  startedAt: Date;
  id: string;
}

export interface WorkoutPageParams {
  from?: string | undefined;
  to?: string | undefined;
  name?: string | undefined;
  after?: WorkoutPosition | null | undefined;
  limit: number;
}

export interface WorkoutRepository {
  /** Upsert by (userId, provider, externalId). Throws ConcurrentUpsertError on duplicate key. */
  upsert(userId: string, provider: ActivityProvider, v: WorkoutValues, receivedAt: Date, newId: string, tx: TxContext): Promise<UpsertResult<Workout>>;
  findById(userId: string, id: string, tx?: TxContext): Promise<Workout | null>;
  /** ordered by startedAt desc, id desc; returns limit+1 items at most */
  page(userId: string, p: WorkoutPageParams): Promise<Workout[]>;
  distinctNames(userId: string): Promise<string[]>;
  listByLocalDate(userId: string, localDate: string): Promise<Workout[]>;
  /** workouts whose localDate >= fromLocalDate */
  listSince(userId: string, fromLocalDate: string, tx?: TxContext): Promise<Workout[]>;
  lastReceivedAt(userId: string): Promise<Date | null>;
}

export interface ActivityGoalRepository {
  findActive(userId: string, tx?: TxContext): Promise<ActivityGoal | null>;
  insert(goal: ActivityGoal, tx: TxContext): Promise<void>;
  updateIfVersion(goal: ActivityGoal, expectedVersion: number, tx: TxContext): Promise<boolean>;
  deactivate(userId: string, now: Date, tx: TxContext): Promise<boolean>;
}

/** Profile timezone (implemented by the profile module's ProfileReader). */
export interface TimezoneReader {
  getTimezone(userId: string): Promise<string>;
}
