import type { Collection, Db, Document, Filter } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryPage, type HistoryParams } from '../../../../../shared/application/repository-errors.js';
import { decodeHistoryCursor, encodeHistoryCursor } from '../../../../../shared/adapters/history-cursor.js';
import { sessionOf } from '../../../../../shared/adapters/mongo-unit-of-work.js';
import { ValidationError } from '../../../../../shared/domain/errors.js';
import type { HydrationGoalRepository, WaterEntryRepository } from '../../../application/ports/index.js';
import type { HydrationGoal } from '../../../domain/hydration-goal.js';
import type { WaterEntry } from '../../../domain/water-entry.js';

// ---------- waterEntries ----------

interface WaterDoc {
  _id: string;
  userId: string;
  consumedAt: Date;
  timezone: string;
  amountMl: number;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const waterToDomain = (d: WaterDoc): WaterEntry => ({
  id: d._id,
  userId: d.userId,
  consumedAt: d.consumedAt,
  timezone: d.timezone,
  amountMl: d.amountMl,
  notes: d.notes ?? null,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
  deletedAt: d.deletedAt ?? null,
});

const waterToDoc = (e: WaterEntry): WaterDoc => ({
  _id: e.id,
  userId: e.userId,
  consumedAt: e.consumedAt,
  timezone: e.timezone,
  amountMl: e.amountMl,
  notes: e.notes,
  version: e.version,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
  deletedAt: e.deletedAt,
});

const SORT_DESC = { consumedAt: -1, _id: -1 } as const;

/**
 * Every query is scoped by userId; edits use `{_id, userId, version}` + `$inc: {version: 1}`;
 * deletes are tombstones (deletedAt). Index: userId + consumedAt + _id (history, summary, bootstrap).
 */
export class MongoWaterEntryRepository implements WaterEntryRepository {
  private readonly col: Collection<WaterDoc>;
  constructor(db: Db) {
    this.col = db.collection<WaterDoc>('waterEntries');
  }

  async findById(userId: string, id: string, tx?: TxContext) {
    const d = await this.col.findOne({ _id: id, userId }, { session: sessionOf(tx) });
    return d ? waterToDomain(d) : null;
  }

  async ownerOf(id: string, tx?: TxContext) {
    const d = await this.col.findOne({ _id: id }, { session: sessionOf(tx), projection: { userId: 1 } });
    return d ? d.userId : null;
  }

  async insert(e: WaterEntry, tx: TxContext) {
    try {
      await this.col.insertOne(waterToDoc(e), { session: sessionOf(tx) });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DuplicateIdError(e.id);
      throw err;
    }
  }

  async updateIfVersion(e: WaterEntry, expectedVersion: number, tx: TxContext) {
    const { _id, userId, version, createdAt, ...rest } = waterToDoc(e);
    void version;
    void createdAt;
    const r = await this.col.updateOne({ _id, userId, version: expectedVersion }, { $set: rest, $inc: { version: 1 } }, { session: sessionOf(tx) });
    return r.matchedCount === 1;
  }

  async page(userId: string, params: HistoryParams, tx?: TxContext): Promise<HistoryPage<WaterEntry>> {
    const and: Document[] = [{ userId }, { deletedAt: null }];
    const consumed: Document = {};
    if (params.from) consumed.$gte = params.from;
    if (params.to) consumed.$lt = params.to;
    if (Object.keys(consumed).length) and.push({ consumedAt: consumed });
    if (params.cursor) {
      const after = decodeHistoryCursor(params.cursor);
      if (!after) throw new ValidationError('Cursor inválido', { cursor: ['Cursor inválido'] });
      and.push({ $or: [{ consumedAt: { $lt: after.measuredAt } }, { consumedAt: after.measuredAt, _id: { $lt: after.id } }] });
    }
    const docs = await this.col
      .find({ $and: and } as Filter<WaterDoc>, { session: sessionOf(tx) })
      .sort(SORT_DESC)
      .limit(params.limit + 1)
      .toArray();
    const items = docs.slice(0, params.limit).map(waterToDomain);
    const lookaheadDoc = docs[params.limit];
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: lookaheadDoc && last ? encodeHistoryCursor({ measuredAt: last.consumedAt, id: last.id }) : null,
      lookahead: lookaheadDoc ? waterToDomain(lookaheadDoc) : null,
    };
  }

  async listLiveBetween(userId: string, from: Date, to: Date | null, tx?: TxContext) {
    const consumedAt: Document = { $gte: from };
    if (to) consumedAt.$lt = to;
    const docs = await this.col
      .find({ userId, deletedAt: null, consumedAt } as Filter<WaterDoc>, { session: sessionOf(tx) })
      .sort({ consumedAt: 1, _id: 1 })
      .toArray();
    return docs.map(waterToDomain);
  }

  async ensureIndexes() {
    await this.col.createIndex({ userId: 1, consumedAt: -1, _id: -1 }, { name: 'userId_consumedAt_id' });
  }
}

// ---------- hydrationGoals ----------

interface HydrationGoalDoc {
  _id: string;
  userId: string;
  dailyTargetMl: number;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt?: Date;
}

const goalToDomain = (d: HydrationGoalDoc): HydrationGoal => ({
  id: d._id,
  userId: d.userId,
  dailyTargetMl: d.dailyTargetMl,
  active: d.active,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export class MongoHydrationGoalRepository implements HydrationGoalRepository {
  private readonly col: Collection<HydrationGoalDoc>;
  constructor(db: Db) {
    this.col = db.collection<HydrationGoalDoc>('hydrationGoals');
  }
  async findActive(userId: string, tx?: TxContext) {
    const d = await this.col.findOne({ userId, active: true }, { session: sessionOf(tx) });
    return d ? goalToDomain(d) : null;
  }
  async insert(g: HydrationGoal, tx: TxContext) {
    await this.col.insertOne(
      { _id: g.id, userId: g.userId, dailyTargetMl: g.dailyTargetMl, active: g.active, version: g.version, createdAt: g.createdAt, updatedAt: g.updatedAt },
      { session: sessionOf(tx) },
    );
  }
  async updateIfVersion(g: HydrationGoal, expectedVersion: number, tx: TxContext) {
    const r = await this.col.updateOne(
      { _id: g.id, userId: g.userId, version: expectedVersion, active: true },
      { $set: { dailyTargetMl: g.dailyTargetMl, updatedAt: g.updatedAt }, $inc: { version: 1 } },
      { session: sessionOf(tx) },
    );
    return r.matchedCount === 1;
  }
  async deactivate(userId: string, now: Date, tx: TxContext) {
    const r = await this.col.updateOne(
      { userId, active: true },
      { $set: { active: false, updatedAt: now, deactivatedAt: now }, $inc: { version: 1 } },
      { session: sessionOf(tx) },
    );
    return r.matchedCount === 1;
  }
  async ensureIndexes() {
    await this.col.createIndex({ userId: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'userId_active_unique' });
  }
}
