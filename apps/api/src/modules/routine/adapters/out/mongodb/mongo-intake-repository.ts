import type { Collection, Db, Decimal128, Filter } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { fromDecimal128, sessionOf, toDecimal128 } from '../../../../../shared/adapters/index.js';
import type { IntakePageQuery, IntakeRepository } from '../../../application/ports/out/repositories.js';
import type { IntakeRecord, IntakeStatus } from '../../../domain/entities/intake-record.js';

/**
 * intakeRecords document.
 *
 * `occurrenceId` is OMITTED (not null) for ad-hoc intakes.
 * `active: true` is present only while the record is live AND linked to an occurrence. MongoDB partial
 * indexes cannot express `deletedAt: null` (no null/$eq-null/$exists:false support in
 * partialFilterExpression), so this marker drives the partial unique index
 * {occurrenceId: 1} WHERE active = true → at most one live decision per occurrence, while
 * soft-deleted history (active unset) can keep any number of past decisions.
 */
export interface IntakeDoc {
  _id: string;
  userId: string;
  itemId: string;
  occurrenceId?: string;
  active?: true;
  status: IntakeStatus;
  actualTakenAt: Date | null;
  notes: string | null;
  nameSnapshot: string;
  doseSnapshot: Decimal128;
  unitSnapshot: string;
  sortAt: Date;
  deletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const INTAKE_RECORDS = 'intakeRecords';

export const toIntake = (d: IntakeDoc): IntakeRecord => ({
  id: d._id,
  userId: d.userId,
  itemId: d.itemId,
  occurrenceId: d.occurrenceId ?? null,
  status: d.status,
  actualTakenAt: d.actualTakenAt,
  notes: d.notes,
  nameSnapshot: d.nameSnapshot,
  doseSnapshot: fromDecimal128(d.doseSnapshot),
  unitSnapshot: d.unitSnapshot,
  sortAt: d.sortAt,
  deletedAt: d.deletedAt,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

function fromIntake(r: IntakeRecord): IntakeDoc {
  const doc: IntakeDoc = {
    _id: r.id,
    userId: r.userId,
    itemId: r.itemId,
    status: r.status,
    actualTakenAt: r.actualTakenAt,
    notes: r.notes,
    nameSnapshot: r.nameSnapshot,
    doseSnapshot: toDecimal128(r.doseSnapshot),
    unitSnapshot: r.unitSnapshot,
    sortAt: r.sortAt,
    deletedAt: r.deletedAt,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (r.occurrenceId) {
    doc.occurrenceId = r.occurrenceId;
    if (!r.deletedAt) doc.active = true;
  }
  return doc;
}

export class MongoIntakeRepository implements IntakeRepository {
  private readonly col: Collection<IntakeDoc>;

  constructor(db: Db) {
    this.col = db.collection<IntakeDoc>(INTAKE_RECORDS);
  }

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex(
      { occurrenceId: 1 },
      { unique: true, name: 'occurrenceId_live_unique', partialFilterExpression: { active: true, occurrenceId: { $type: 'string' } } },
    );
    await this.col.createIndex({ userId: 1, sortAt: -1, _id: -1 }, { name: 'userId_sortAt_id' });
    await this.col.createIndex({ userId: 1, itemId: 1, sortAt: -1, _id: -1 }, { name: 'userId_itemId_sortAt_id' });
  }

  async insert(intake: IntakeRecord, tx: TxContext): Promise<void> {
    await this.col.insertOne(fromIntake(intake), { session: sessionOf(tx) });
  }

  async getById(userId: string, id: string, tx?: TxContext): Promise<IntakeRecord | null> {
    const d = await this.col.findOne({ _id: id, userId }, { session: sessionOf(tx) });
    return d ? toIntake(d) : null;
  }

  async idExists(id: string, tx?: TxContext): Promise<boolean> {
    return (await this.col.countDocuments({ _id: id }, { limit: 1, session: sessionOf(tx) })) > 0;
  }

  async getLiveByOccurrence(userId: string, occurrenceId: string, tx?: TxContext): Promise<IntakeRecord | null> {
    const d = await this.col.findOne({ userId, occurrenceId, active: true }, { session: sessionOf(tx) });
    return d ? toIntake(d) : null;
  }

  async listLiveByOccurrenceIds(userId: string, occurrenceIds: string[], tx?: TxContext): Promise<IntakeRecord[]> {
    if (occurrenceIds.length === 0) return [];
    const docs = await this.col.find({ userId, occurrenceId: { $in: occurrenceIds }, active: true }, { session: sessionOf(tx) }).toArray();
    return docs.map(toIntake);
  }

  async update(intake: IntakeRecord, expectedVersion: number, tx: TxContext): Promise<boolean> {
    const { _id, userId, active, occurrenceId, ...rest } = fromIntake(intake);
    const res = await this.col.updateOne(
      { _id, userId, version: expectedVersion },
      {
        $set: { ...rest, ...(occurrenceId ? { occurrenceId } : {}), ...(active ? { active } : {}) },
        ...(active ? {} : { $unset: { active: '' as const } }),
      },
      { session: sessionOf(tx) },
    );
    return res.matchedCount === 1;
  }

  async page(userId: string, q: IntakePageQuery, tx?: TxContext): Promise<IntakeRecord[]> {
    const and: Filter<IntakeDoc>[] = [{ userId }, { deletedAt: null }];
    if (q.itemId) and.push({ itemId: q.itemId });
    if (q.from) and.push({ sortAt: { $gte: q.from } });
    if (q.to) and.push({ sortAt: { $lt: q.to } });
    if (q.cursor) {
      and.push({ $or: [{ sortAt: { $lt: q.cursor.sortAt } }, { sortAt: q.cursor.sortAt, _id: { $lt: q.cursor.id } }] });
    }
    const docs = await this.col
      .find({ $and: and }, { session: sessionOf(tx) })
      .sort({ sortAt: -1, _id: -1 })
      .limit(q.limit)
      .toArray();
    return docs.map(toIntake);
  }

  async listLive(userId: string, tx?: TxContext): Promise<IntakeRecord[]> {
    const docs = await this.col.find({ userId, deletedAt: null }, { session: sessionOf(tx) }).sort({ sortAt: -1, _id: -1 }).toArray();
    return docs.map(toIntake);
  }
}
