import type { TxContext } from '../../../../shared/application/ports.js';
import type { HistoryPage, HistoryParams } from '../../../../shared/application/repository-errors.js';
import type { HydrationGoal } from '../../domain/hydration-goal.js';
import type { WaterEntry } from '../../domain/water-entry.js';

export interface WaterEntryRepository {
  /** includes tombstones (deletedAt set) */
  findById(userId: string, id: string, tx?: TxContext): Promise<WaterEntry | null>;
  /** userId that owns this id (any user) or null */
  ownerOf(id: string, tx?: TxContext): Promise<string | null>;
  /** throws DuplicateIdError if the id exists */
  insert(entry: WaterEntry, tx: TxContext): Promise<void>;
  /** atomic `{_id, userId, version: expectedVersion}` + `$inc version`; false on mismatch */
  updateIfVersion(entry: WaterEntry, expectedVersion: number, tx: TxContext): Promise<boolean>;
  /** live entries, consumedAt desc, id desc */
  page(userId: string, params: HistoryParams, tx?: TxContext): Promise<HistoryPage<WaterEntry>>;
  /** live entries with consumedAt in [from, to) (to optional), consumedAt asc */
  listLiveBetween(userId: string, from: Date, to: Date | null, tx?: TxContext): Promise<WaterEntry[]>;
}

export interface HydrationGoalRepository {
  findActive(userId: string, tx?: TxContext): Promise<HydrationGoal | null>;
  insert(goal: HydrationGoal, tx: TxContext): Promise<void>;
  updateIfVersion(goal: HydrationGoal, expectedVersion: number, tx: TxContext): Promise<boolean>;
  /** deactivates the active goal; false if none */
  deactivate(userId: string, now: Date, tx: TxContext): Promise<boolean>;
}

/** Profile timezone lookup (satisfied by the profile module's ProfileReader). */
export interface TimezoneProvider {
  getTimezone(userId: string): Promise<string>;
}
