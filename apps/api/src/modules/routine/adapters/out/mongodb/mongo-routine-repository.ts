import type { Collection, Db, Decimal128 } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { fromDecimal128, sessionOf, toDecimal128 } from '../../../../../shared/adapters/index.js';
import type { RoutineRepository } from '../../../application/ports/out/repositories.js';
import type { RoutineItem, RoutineItemType } from '../../../domain/entities/routine-item.js';
import type { Frequency, ScheduleVersion } from '../../../domain/entities/schedule-version.js';

export interface RoutineItemDoc {
  _id: string;
  userId: string;
  name: string;
  type: RoutineItemType;
  currentDose: Decimal128;
  currentUnit: string;
  instructions: string | null;
  archivedAt: Date | null;
  currentScheduleVersionId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleVersionDoc {
  _id: string;
  userId: string;
  itemId: string;
  frequency: Frequency;
  weekdays: number[];
  times: string[];
  timezone: string;
  startDate: string;
  endDate: string | null;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  coverageFrom: Date;
  doseSnapshot: Decimal128;
  unitSnapshot: string;
  reminderEnabled: boolean;
  createdAt: Date;
}

export const ROUTINE_ITEMS = 'routineItems';
export const SCHEDULE_VERSIONS = 'scheduleVersions';

const toItem = (d: RoutineItemDoc): RoutineItem => ({
  id: d._id,
  userId: d.userId,
  name: d.name,
  type: d.type,
  currentDose: fromDecimal128(d.currentDose),
  currentUnit: d.currentUnit,
  instructions: d.instructions,
  archivedAt: d.archivedAt,
  currentScheduleVersionId: d.currentScheduleVersionId,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

const fromItem = (i: RoutineItem): RoutineItemDoc => ({
  _id: i.id,
  userId: i.userId,
  name: i.name,
  type: i.type,
  currentDose: toDecimal128(i.currentDose),
  currentUnit: i.currentUnit,
  instructions: i.instructions,
  archivedAt: i.archivedAt,
  currentScheduleVersionId: i.currentScheduleVersionId,
  version: i.version,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

const toVersion = (d: ScheduleVersionDoc): ScheduleVersion => ({
  id: d._id,
  userId: d.userId,
  itemId: d.itemId,
  frequency: d.frequency,
  weekdays: d.weekdays,
  times: d.times,
  timezone: d.timezone,
  startDate: d.startDate,
  endDate: d.endDate,
  effectiveFrom: d.effectiveFrom,
  effectiveUntil: d.effectiveUntil,
  coverageFrom: d.coverageFrom,
  doseSnapshot: fromDecimal128(d.doseSnapshot),
  unitSnapshot: d.unitSnapshot,
  reminderEnabled: d.reminderEnabled,
  createdAt: d.createdAt,
});

export class MongoRoutineRepository implements RoutineRepository {
  private readonly items: Collection<RoutineItemDoc>;
  private readonly versions: Collection<ScheduleVersionDoc>;

  constructor(db: Db) {
    this.items = db.collection<RoutineItemDoc>(ROUTINE_ITEMS);
    this.versions = db.collection<ScheduleVersionDoc>(SCHEDULE_VERSIONS);
  }

  async ensureIndexes(): Promise<void> {
    await this.items.createIndex({ userId: 1, archivedAt: 1 }, { name: 'userId_archivedAt' });
    await this.versions.createIndex({ userId: 1, itemId: 1, effectiveFrom: 1 }, { name: 'userId_itemId_effectiveFrom' });
    // horizon job: open versions
    await this.versions.createIndex({ effectiveUntil: 1, frequency: 1 }, { name: 'effectiveUntil_frequency' });
  }

  async insertItem(item: RoutineItem, tx: TxContext): Promise<void> {
    await this.items.insertOne(fromItem(item), { session: sessionOf(tx) });
  }

  async getItem(userId: string, id: string, tx?: TxContext): Promise<RoutineItem | null> {
    const d = await this.items.findOne({ _id: id, userId }, { session: sessionOf(tx) });
    return d ? toItem(d) : null;
  }

  async itemIdExists(id: string, tx?: TxContext): Promise<boolean> {
    return (await this.items.countDocuments({ _id: id }, { limit: 1, session: sessionOf(tx) })) > 0;
  }

  async listItems(userId: string, includeArchived: boolean, tx?: TxContext): Promise<RoutineItem[]> {
    const filter = includeArchived ? { userId } : { userId, archivedAt: null };
    const docs = await this.items.find(filter, { session: sessionOf(tx) }).sort({ name: 1, _id: 1 }).toArray();
    return docs.map(toItem);
  }

  async updateItem(item: RoutineItem, expectedVersion: number, tx: TxContext): Promise<boolean> {
    const { _id, userId, createdAt, ...rest } = fromItem(item);
    void createdAt;
    const res = await this.items.updateOne({ _id, userId, version: expectedVersion }, { $set: rest }, { session: sessionOf(tx) });
    return res.matchedCount === 1;
  }

  async insertVersion(v: ScheduleVersion, tx: TxContext): Promise<void> {
    await this.versions.insertOne(
      {
        _id: v.id,
        userId: v.userId,
        itemId: v.itemId,
        frequency: v.frequency,
        weekdays: v.weekdays,
        times: v.times,
        timezone: v.timezone,
        startDate: v.startDate,
        endDate: v.endDate,
        effectiveFrom: v.effectiveFrom,
        effectiveUntil: v.effectiveUntil,
        coverageFrom: v.coverageFrom,
        doseSnapshot: toDecimal128(v.doseSnapshot),
        unitSnapshot: v.unitSnapshot,
        reminderEnabled: v.reminderEnabled,
        createdAt: v.createdAt,
      },
      { session: sessionOf(tx) },
    );
  }

  async closeVersion(userId: string, versionId: string, until: Date, tx: TxContext): Promise<void> {
    await this.versions.updateOne({ _id: versionId, userId, effectiveUntil: null }, { $set: { effectiveUntil: until } }, { session: sessionOf(tx) });
  }

  async getVersion(userId: string, versionId: string, tx?: TxContext): Promise<ScheduleVersion | null> {
    const d = await this.versions.findOne({ _id: versionId, userId }, { session: sessionOf(tx) });
    return d ? toVersion(d) : null;
  }

  async getVersions(userId: string, versionIds: string[], tx?: TxContext): Promise<ScheduleVersion[]> {
    if (versionIds.length === 0) return [];
    const docs = await this.versions.find({ _id: { $in: versionIds }, userId }, { session: sessionOf(tx) }).toArray();
    return docs.map(toVersion);
  }

  async listGeneratableVersions(userId: string, from: Date, to: Date, tx?: TxContext): Promise<ScheduleVersion[]> {
    const docs = await this.versions
      .find(
        {
          userId,
          frequency: { $ne: 'none' },
          coverageFrom: { $lt: to },
          $or: [{ effectiveUntil: null }, { effectiveUntil: { $gt: from } }],
        },
        { session: sessionOf(tx) },
      )
      .toArray();
    return docs.map(toVersion);
  }

  async listUsersWithOpenVersions(): Promise<string[]> {
    return (await this.versions.distinct('userId', { effectiveUntil: null, frequency: { $ne: 'none' } })) as string[];
  }
}
