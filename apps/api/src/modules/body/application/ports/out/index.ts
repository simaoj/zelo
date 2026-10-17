import type { TxContext } from '../../../../../shared/application/ports.js';
import type { HistoryPage, HistoryParams } from '../../../../../shared/application/repository-errors.js';
import type { MeasurementSession } from '../../../domain/entities/measurement-session.js';
import type { WeightEntry } from '../../../domain/entities/weight-entry.js';
import type { WeightGoal } from '../../../domain/entities/weight-goal.js';

export interface Position {
  measuredAt: Date;
  id: string;
}

export interface WeightRepository {
  /** includes tombstones (deletedAt set) */
  findById(userId: string, id: string, tx?: TxContext): Promise<WeightEntry | null>;
  /** throws DuplicateIdError if the id exists */
  insert(entry: WeightEntry, tx: TxContext): Promise<void>;
  /** atomic `{_id, userId, version: expectedVersion}` + `$inc version`; false on mismatch */
  updateIfVersion(entry: WeightEntry, expectedVersion: number, tx: TxContext): Promise<boolean>;
  /** live entries, measuredAt desc, id desc */
  page(userId: string, params: HistoryParams, tx?: TxContext): Promise<HistoryPage<WeightEntry>>;
  /** chronologically previous live entry */
  previousOf(userId: string, pos: Position, tx?: TxContext): Promise<WeightEntry | null>;
  /** chronologically next live entry */
  nextOf(userId: string, pos: Position, tx?: TxContext): Promise<WeightEntry | null>;
  /** most recent live entries, desc */
  latest(userId: string, limit: number, tx?: TxContext): Promise<WeightEntry[]>;
  listLive(userId: string, tx?: TxContext): Promise<WeightEntry[]>;
}

export interface WeightGoalRepository {
  findActive(userId: string, tx?: TxContext): Promise<WeightGoal | null>;
  insert(goal: WeightGoal, tx: TxContext): Promise<void>;
  updateIfVersion(goal: WeightGoal, expectedVersion: number, tx: TxContext): Promise<boolean>;
  /** deactivates the active goal; false if none */
  deactivate(userId: string, now: Date, tx: TxContext): Promise<boolean>;
}

export interface MeasurementRepository {
  findById(userId: string, id: string, tx?: TxContext): Promise<MeasurementSession | null>;
  insert(session: MeasurementSession, tx: TxContext): Promise<void>;
  updateIfVersion(session: MeasurementSession, expectedVersion: number, tx: TxContext): Promise<boolean>;
  page(userId: string, params: HistoryParams, tx?: TxContext): Promise<HistoryPage<MeasurementSession>>;
  /** most recent live sessions, desc */
  latest(userId: string, limit: number, tx?: TxContext): Promise<MeasurementSession[]>;
  listLive(userId: string, tx?: TxContext): Promise<MeasurementSession[]>;
}
