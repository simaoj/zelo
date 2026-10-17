import type { TxContext } from '../../../../../shared/application/ports.js';
import type { RoutineItem } from '../../../domain/entities/routine-item.js';
import type { ScheduleVersion } from '../../../domain/entities/schedule-version.js';
import type { Occurrence } from '../../../domain/entities/occurrence.js';
import type { IntakeRecord } from '../../../domain/entities/intake-record.js';

/** Every method is scoped by the authorized userId (spec §7). */
export interface RoutineRepository {
  insertItem(item: RoutineItem, tx: TxContext): Promise<void>;
  getItem(userId: string, id: string, tx?: TxContext): Promise<RoutineItem | null>;
  /** true if an item with this id exists for ANY user (id collision guard) */
  itemIdExists(id: string, tx?: TxContext): Promise<boolean>;
  listItems(userId: string, includeArchived: boolean, tx?: TxContext): Promise<RoutineItem[]>;
  /** Optimistic update: matches {id, userId, version: expectedVersion}; false when nothing matched. */
  updateItem(item: RoutineItem, expectedVersion: number, tx: TxContext): Promise<boolean>;

  insertVersion(version: ScheduleVersion, tx: TxContext): Promise<void>;
  closeVersion(userId: string, versionId: string, until: Date, tx: TxContext): Promise<void>;
  getVersion(userId: string, versionId: string, tx?: TxContext): Promise<ScheduleVersion | null>;
  getVersions(userId: string, versionIds: string[], tx?: TxContext): Promise<ScheduleVersion[]>;
  /** Versions with frequency != none that may produce slots in [from, to). */
  listGeneratableVersions(userId: string, from: Date, to: Date, tx?: TxContext): Promise<ScheduleVersion[]>;
  /** For the background horizon job: users having at least one open (effectiveUntil null) generating version. */
  listUsersWithOpenVersions(): Promise<string[]>;
}

export interface NewOccurrence extends Omit<Occurrence, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'cancelledAt'> {
  /** id used only if the slot does not exist yet */
  id: string;
}

export interface OccurrenceRepository {
  /**
   * Idempotent insert keyed by (scheduleVersionId, localDate, localTime).
   * Returns ids of documents actually created by this call.
   */
  upsertSlots(occurrences: NewOccurrence[], now: Date, tx: TxContext): Promise<string[]>;
  getById(userId: string, id: string, tx?: TxContext): Promise<Occurrence | null>;
  /** live (not cancelled) occurrences with scheduledAt in [from, to), ordered by scheduledAt, id */
  listLiveInRange(userId: string, from: Date, to: Date, tx?: TxContext): Promise<Occurrence[]>;
  /** live occurrences of an item (optionally a single version) with scheduledAt >= from */
  listLiveFrom(userId: string, filter: { itemId: string; scheduleVersionId?: string }, from: Date, tx: TxContext): Promise<Occurrence[]>;
  cancel(userId: string, ids: string[], at: Date, tx: TxContext): Promise<void>;
  updateSnapshots(userId: string, ids: string[], patch: { nameSnapshot: string; itemType: Occurrence['itemType'] }, at: Date, tx: TxContext): Promise<void>;
}

export interface IntakePageQuery {
  itemId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: { sortAt: Date; id: string } | undefined;
  limit: number;
}

export interface IntakeRepository {
  insert(intake: IntakeRecord, tx: TxContext): Promise<void>;
  /** by id regardless of deletion (callers decide) */
  getById(userId: string, id: string, tx?: TxContext): Promise<IntakeRecord | null>;
  idExists(id: string, tx?: TxContext): Promise<boolean>;
  getLiveByOccurrence(userId: string, occurrenceId: string, tx?: TxContext): Promise<IntakeRecord | null>;
  listLiveByOccurrenceIds(userId: string, occurrenceIds: string[], tx?: TxContext): Promise<IntakeRecord[]>;
  /** optimistic update on version; false if nothing matched */
  update(intake: IntakeRecord, expectedVersion: number, tx: TxContext): Promise<boolean>;
  page(userId: string, q: IntakePageQuery, tx?: TxContext): Promise<IntakeRecord[]>;
  listLive(userId: string, tx?: TxContext): Promise<IntakeRecord[]>;
}
