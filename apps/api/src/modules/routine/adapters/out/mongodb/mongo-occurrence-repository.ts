import type { AnyBulkWriteOperation, Collection, Db, Decimal128 } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { fromDecimal128, sessionOf, toDecimal128 } from '../../../../../shared/adapters/index.js';
import type { NewOccurrence, OccurrenceRepository } from '../../../application/ports/out/repositories.js';
import type { Occurrence } from '../../../domain/entities/occurrence.js';
import type { RoutineItemType } from '../../../domain/entities/routine-item.js';

export interface OccurrenceDoc {
  _id: string;
  userId: string;
  itemId: string;
  scheduleVersionId: string;
  scheduledAt: Date;
  localDate: string;
  localTime: string;
  nameSnapshot: string;
  doseSnapshot: Decimal128;
  unitSnapshot: string;
  itemType: RoutineItemType;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const OCCURRENCES = 'occurrences';

export const toOccurrence = (d: OccurrenceDoc): Occurrence => ({
  id: d._id,
  userId: d.userId,
  itemId: d.itemId,
  scheduleVersionId: d.scheduleVersionId,
  scheduledAt: d.scheduledAt,
  localDate: d.localDate,
  localTime: d.localTime,
  nameSnapshot: d.nameSnapshot,
  doseSnapshot: fromDecimal128(d.doseSnapshot),
  unitSnapshot: d.unitSnapshot,
  itemType: d.itemType,
  cancelledAt: d.cancelledAt,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export class MongoOccurrenceRepository implements OccurrenceRepository {
  private readonly col: Collection<OccurrenceDoc>;

  constructor(db: Db) {
    this.col = db.collection<OccurrenceDoc>(OCCURRENCES);
  }

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex(
      { scheduleVersionId: 1, localDate: 1, localTime: 1 },
      { unique: true, name: 'scheduleVersionId_localDate_localTime_unique' },
    );
    await this.col.createIndex({ userId: 1, scheduledAt: 1 }, { name: 'userId_scheduledAt' });
    await this.col.createIndex({ userId: 1, itemId: 1, scheduledAt: 1 }, { name: 'userId_itemId_scheduledAt' });
    // notifications planner: upcoming live occurrences across users
    await this.col.createIndex({ scheduledAt: 1 }, { name: 'scheduledAt' });
  }

  async upsertSlots(occurrences: NewOccurrence[], now: Date, tx: TxContext): Promise<string[]> {
    if (occurrences.length === 0) return [];
    const ops: AnyBulkWriteOperation<OccurrenceDoc>[] = occurrences.map((o) => ({
      updateOne: {
        filter: { scheduleVersionId: o.scheduleVersionId, localDate: o.localDate, localTime: o.localTime },
        update: {
          $setOnInsert: {
            _id: o.id,
            userId: o.userId,
            itemId: o.itemId,
            scheduledAt: o.scheduledAt,
            nameSnapshot: o.nameSnapshot,
            doseSnapshot: toDecimal128(o.doseSnapshot),
            unitSnapshot: o.unitSnapshot,
            itemType: o.itemType,
            cancelledAt: null,
            version: 0,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    }));
    const res = await this.col.bulkWrite(ops, { ordered: true, session: sessionOf(tx) });
    return Object.values(res.upsertedIds).map(String);
  }

  async getById(userId: string, id: string, tx?: TxContext): Promise<Occurrence | null> {
    const d = await this.col.findOne({ _id: id, userId }, { session: sessionOf(tx) });
    return d ? toOccurrence(d) : null;
  }

  async listLiveInRange(userId: string, from: Date, to: Date, tx?: TxContext): Promise<Occurrence[]> {
    const docs = await this.col
      .find({ userId, cancelledAt: null, scheduledAt: { $gte: from, $lt: to } }, { session: sessionOf(tx) })
      .sort({ scheduledAt: 1, nameSnapshot: 1, _id: 1 })
      .toArray();
    return docs.map(toOccurrence);
  }

  async listLiveFrom(userId: string, filter: { itemId: string; scheduleVersionId?: string }, from: Date, tx: TxContext): Promise<Occurrence[]> {
    const docs = await this.col
      .find(
        { userId, itemId: filter.itemId, ...(filter.scheduleVersionId ? { scheduleVersionId: filter.scheduleVersionId } : {}), cancelledAt: null, scheduledAt: { $gte: from } },
        { session: sessionOf(tx) },
      )
      .toArray();
    return docs.map(toOccurrence);
  }

  async cancel(userId: string, ids: string[], at: Date, tx: TxContext): Promise<void> {
    if (ids.length === 0) return;
    await this.col.updateMany(
      { _id: { $in: ids }, userId, cancelledAt: null },
      { $set: { cancelledAt: at, updatedAt: at }, $inc: { version: 1 } },
      { session: sessionOf(tx) },
    );
  }

  async updateSnapshots(userId: string, ids: string[], patch: { nameSnapshot: string; itemType: RoutineItemType }, at: Date, tx: TxContext): Promise<void> {
    if (ids.length === 0) return;
    await this.col.updateMany(
      { _id: { $in: ids }, userId },
      { $set: { nameSnapshot: patch.nameSnapshot, itemType: patch.itemType, updatedAt: at }, $inc: { version: 1 } },
      { session: sessionOf(tx) },
    );
  }
}
