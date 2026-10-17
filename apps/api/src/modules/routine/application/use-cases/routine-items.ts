import type { RoutineItem as RoutineItemDto } from '@zelo/contracts';
import type { TxContext } from '../../../../shared/application/ports.js';
import { NotFoundError, ValidationError, VersionConflictError } from '../../../../shared/domain/errors.js';
import {
  archiveRoutineItem,
  assertNotArchived,
  createRoutineItem,
  editRoutineItem,
  type RoutineItem,
} from '../../domain/entities/routine-item.js';
import { createScheduleVersion, type ScheduleSpec, type ScheduleVersion } from '../../domain/entities/schedule-version.js';
import { selectFuturePending } from '../../domain/entities/occurrence.js';
import { canonicalDose, canonicalUnit } from '../../domain/value-objects/dose.js';
import type { RoutineAppDeps } from '../deps.js';
import { toItemDto } from '../presenters.js';
import { GenerateOccurrences } from './generate-occurrences.js';

export interface CreateRoutineItemInput {
  id: string;
  name: string;
  type: string;
  dose: string;
  unit: string;
  instructions?: string | null | undefined;
  schedule: ScheduleSpec;
}

export interface Result<T> {
  status: number;
  body: T;
}

/** Shared helpers for item use cases. */
abstract class ItemUseCase {
  protected readonly generator: GenerateOccurrences;
  constructor(protected readonly d: RoutineAppDeps) {
    this.generator = new GenerateOccurrences(d);
  }

  protected async dto(item: RoutineItem, tx?: TxContext): Promise<RoutineItemDto> {
    const v = item.currentScheduleVersionId ? await this.d.routines.getVersion(item.userId, item.currentScheduleVersionId, tx) : null;
    return toItemDto(item, v);
  }

  protected async loadForUpdate(userId: string, id: string, expectedVersion: number, tx: TxContext): Promise<RoutineItem> {
    const item = await this.d.routines.getItem(userId, id, tx);
    if (!item) throw new NotFoundError('Item');
    if (item.version !== expectedVersion) throw new VersionConflictError(await this.dto(item, tx));
    return item;
  }

  protected async save(item: RoutineItem, expectedVersion: number, tx: TxContext): Promise<void> {
    if (!(await this.d.routines.updateItem(item, expectedVersion, tx))) {
      const current = await this.d.routines.getItem(item.userId, item.id, tx);
      throw new VersionConflictError(current ? await this.dto(current, tx) : undefined);
    }
    await this.d.changeLog.record(tx, item.userId, { entity: 'routineItem', id: item.id, op: 'upsert' });
  }

  /**
   * Cancels future (scheduledAt >= now) occurrences of the item that have NO recorded decision.
   * Past occurrences and anything with a decision are never touched (spec §6 versioning).
   */
  protected async cancelFuturePending(userId: string, itemId: string, now: Date, tx: TxContext): Promise<string[]> {
    const candidates = await this.d.occurrences.listLiveFrom(userId, { itemId }, now, tx);
    if (candidates.length === 0) return [];
    const decided = await this.d.intakes.listLiveByOccurrenceIds(userId, candidates.map((o) => o.id), tx);
    const toCancel = selectFuturePending(candidates, new Set(decided.map((i) => i.occurrenceId!)), now).map((o) => o.id);
    if (toCancel.length === 0) return [];
    await this.d.occurrences.cancel(userId, toCancel, now, tx);
    // cancelled occurrences are no longer visible → tombstones for sync
    for (const id of toCancel) await this.d.changeLog.record(tx, userId, { entity: 'occurrence', id, op: 'delete' });
    return toCancel;
  }
}

export class CreateRoutineItem extends ItemUseCase {
  async execute(userId: string, input: CreateRoutineItemInput, tx: TxContext): Promise<Result<RoutineItemDto>> {
    const now = this.d.clock.now();
    if (await this.d.routines.itemIdExists(input.id, tx)) {
      throw new ValidationError('Identificador já utilizado', { id: ['Identificador já utilizado'] });
    }
    const item = createRoutineItem({ ...input, userId, now });
    const version = createScheduleVersion({
      id: this.d.ids.next(),
      userId,
      itemId: item.id,
      spec: input.schedule,
      dose: item.currentDose,
      unit: item.currentUnit,
      now,
      isFirst: true,
    });
    item.currentScheduleVersionId = version.id;
    await this.d.routines.insertItem(item, tx);
    await this.d.routines.insertVersion(version, tx);
    await this.d.changeLog.record(tx, userId, { entity: 'routineItem', id: item.id, op: 'upsert' });
    await this.generator.forWindow(userId, [version], tx);
    return { status: 201, body: toItemDto(item, version) };
  }
}

export class UpdateRoutineItem extends ItemUseCase {
  async execute(
    userId: string,
    id: string,
    input: { expectedVersion: number; name?: string | undefined; type?: string | undefined; instructions?: string | null | undefined },
    tx: TxContext,
  ): Promise<Result<RoutineItemDto>> {
    const now = this.d.clock.now();
    const item = await this.loadForUpdate(userId, id, input.expectedVersion, tx);
    const updated = editRoutineItem(item, input, now);
    await this.save(updated, item.version, tx);

    // Future pending occurrences show the new name/type; past ones and recorded intakes keep their snapshots.
    if (updated.name !== item.name || updated.type !== item.type) {
      const future = await this.d.occurrences.listLiveFrom(userId, { itemId: id }, now, tx);
      if (future.length > 0) {
        const decided = new Set(
          (await this.d.intakes.listLiveByOccurrenceIds(userId, future.map((o) => o.id), tx)).map((i) => i.occurrenceId!),
        );
        const ids = selectFuturePending(future, decided, now).map((o) => o.id);
        if (ids.length > 0) {
          await this.d.occurrences.updateSnapshots(userId, ids, { nameSnapshot: updated.name, itemType: updated.type }, now, tx);
          for (const oid of ids) await this.d.changeLog.record(tx, userId, { entity: 'occurrence', id: oid, op: 'upsert' });
        }
      }
    }
    return { status: 200, body: await this.dto(updated, tx) };
  }
}

/**
 * ReviseSchedule: new version effective from confirmation (now). Closes the previous version,
 * cancels only FUTURE PENDING occurrences, generates the new window. Past occurrences and
 * recorded decisions are never modified.
 */
export class ReviseSchedule extends ItemUseCase {
  async execute(
    userId: string,
    id: string,
    input: { expectedVersion: number; dose: string; unit: string; schedule: ScheduleSpec },
    tx: TxContext,
  ): Promise<Result<RoutineItemDto>> {
    const now = this.d.clock.now();
    const item = await this.loadForUpdate(userId, id, input.expectedVersion, tx);
    assertNotArchived(item);
    const dose = canonicalDose(input.dose);
    const unit = canonicalUnit(input.unit);
    const version: ScheduleVersion = createScheduleVersion({
      id: this.d.ids.next(),
      userId,
      itemId: id,
      spec: input.schedule,
      dose,
      unit,
      now,
      isFirst: item.currentScheduleVersionId === null,
    });
    if (item.currentScheduleVersionId) await this.d.routines.closeVersion(userId, item.currentScheduleVersionId, now, tx);
    await this.cancelFuturePending(userId, id, now, tx);
    await this.d.routines.insertVersion(version, tx);
    const updated: RoutineItem = {
      ...item,
      currentDose: dose,
      currentUnit: unit,
      currentScheduleVersionId: version.id,
      version: item.version + 1,
      updatedAt: now,
    };
    await this.save(updated, item.version, tx);
    await this.generator.forWindow(userId, [version], tx);
    return { status: 200, body: toItemDto(updated, version) };
  }
}

/** ArchiveRoutineItem: stops the future (closes the version, cancels future pending), preserves history. */
export class ArchiveRoutineItem extends ItemUseCase {
  async execute(userId: string, id: string, input: { expectedVersion: number }, tx: TxContext): Promise<Result<RoutineItemDto>> {
    const now = this.d.clock.now();
    const item = await this.loadForUpdate(userId, id, input.expectedVersion, tx);
    const archived = archiveRoutineItem(item, now);
    if (item.currentScheduleVersionId) await this.d.routines.closeVersion(userId, item.currentScheduleVersionId, now, tx);
    await this.cancelFuturePending(userId, id, now, tx);
    await this.save(archived, item.version, tx);
    return { status: 200, body: await this.dto(archived, tx) };
  }
}

export class ListRoutineItems {
  constructor(private readonly d: RoutineAppDeps) {}

  async execute(userId: string, includeArchived: boolean, tx?: TxContext): Promise<RoutineItemDto[]> {
    const items = await this.d.routines.listItems(userId, includeArchived, tx);
    const versionIds = items.map((i) => i.currentScheduleVersionId).filter((v): v is string => v !== null);
    const versions = new Map((await this.d.routines.getVersions(userId, versionIds, tx)).map((v) => [v.id, v]));
    return items.map((i) => toItemDto(i, i.currentScheduleVersionId ? (versions.get(i.currentScheduleVersionId) ?? null) : null));
  }

  async byId(userId: string, id: string, tx?: TxContext): Promise<RoutineItemDto | null> {
    const item = await this.d.routines.getItem(userId, id, tx);
    if (!item) return null;
    const v = item.currentScheduleVersionId ? await this.d.routines.getVersion(userId, item.currentScheduleVersionId, tx) : null;
    return toItemDto(item, v);
  }
}
