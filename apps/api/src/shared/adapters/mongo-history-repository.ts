import type { Collection, Db, Document, Filter, OptionalUnlessRequiredId } from 'mongodb';
import type { TxContext } from '../application/ports.js';
import { DuplicateIdError, type HistoryPage, type HistoryParams } from '../application/repository-errors.js';
import { ValidationError } from '../domain/errors.js';
import { decodeHistoryCursor, encodeHistoryCursor, historyFilter, HISTORY_SORT } from './history-cursor.js';
import { sessionOf } from './mongo-unit-of-work.js';

/** Minimum shape of a timestamped, versioned, soft-deletable health-record document. */
export interface HistoryDoc extends Document {
  _id: string;
  userId: string;
  measuredAt: Date;
  version: number;
  deletedAt: Date | null;
}

export interface HistoryEntity {
  id: string;
  userId: string;
  measuredAt: Date;
  version: number;
}

/**
 * Generic repository for history collections (weights, measurement sessions, blood pressure):
 * every query is scoped by userId; edits use `{_id, userId, version}` + `$inc: {version: 1}`;
 * deletes are tombstones (deletedAt). Index: userId + measuredAt + _id.
 */
export class MongoHistoryRepository<D extends HistoryDoc, E extends HistoryEntity> {
  protected readonly col: Collection<D>;

  constructor(
    db: Db,
    collectionName: string,
    protected readonly toDomain: (d: D) => E,
    protected readonly toDoc: (e: E) => D,
  ) {
    this.col = db.collection<D>(collectionName);
  }

  async findById(userId: string, id: string, tx?: TxContext): Promise<E | null> {
    const d = await this.col.findOne({ _id: id, userId } as Filter<D>, { session: sessionOf(tx) });
    return d ? this.toDomain(d as D) : null;
  }

  /** userId owning `id` (any user), or null. Used to reject id reuse before inserting. */
  async ownerOf(id: string, tx?: TxContext): Promise<string | null> {
    const d = await this.col.findOne({ _id: id } as Filter<D>, { session: sessionOf(tx), projection: { userId: 1 } });
    return d ? (d as D).userId : null;
  }

  async insert(entity: E, tx: TxContext): Promise<void> {
    try {
      await this.col.insertOne(this.toDoc(entity) as OptionalUnlessRequiredId<D>, { session: sessionOf(tx) });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new DuplicateIdError(entity.id);
      throw err;
    }
  }

  async updateIfVersion(entity: E, expectedVersion: number, tx: TxContext): Promise<boolean> {
    const doc = this.toDoc(entity) as Document;
    const { _id, userId, version, createdAt, ...rest } = doc;
    void createdAt;
    void version;
    const res = await this.col.updateOne(
      { _id, userId, version: expectedVersion } as Filter<D>,
      { $set: rest as Partial<D>, $inc: { version: 1 } } as Document,
      { session: sessionOf(tx) },
    );
    return res.matchedCount === 1;
  }

  async page(userId: string, params: HistoryParams, tx?: TxContext): Promise<HistoryPage<E>> {
    let after = null;
    if (params.cursor) {
      after = decodeHistoryCursor(params.cursor);
      if (!after) throw new ValidationError('Cursor inválido', { cursor: ['Cursor inválido'] });
    }
    const docs = await this.col
      .find(historyFilter<D>(userId, { from: params.from, to: params.to, after }), { session: sessionOf(tx) })
      .sort(HISTORY_SORT)
      .limit(params.limit + 1)
      .toArray();
    const items = docs.slice(0, params.limit).map((d) => this.toDomain(d as D));
    const lookaheadDoc = docs[params.limit];
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: lookaheadDoc && last ? encodeHistoryCursor({ measuredAt: last.measuredAt, id: last.id }) : null,
      lookahead: lookaheadDoc ? this.toDomain(lookaheadDoc as D) : null,
    };
  }

  async previousOf(userId: string, pos: { measuredAt: Date; id: string }, tx?: TxContext): Promise<E | null> {
    const d = await this.col
      .find(historyFilter<D>(userId, { after: pos }), { session: sessionOf(tx) })
      .sort(HISTORY_SORT)
      .limit(1)
      .next();
    return d ? this.toDomain(d as D) : null;
  }

  async nextOf(userId: string, pos: { measuredAt: Date; id: string }, tx?: TxContext): Promise<E | null> {
    const filter = {
      userId,
      deletedAt: null,
      $or: [{ measuredAt: { $gt: pos.measuredAt } }, { measuredAt: pos.measuredAt, _id: { $gt: pos.id } }],
    } as Filter<D>;
    const d = await this.col.find(filter, { session: sessionOf(tx) }).sort({ measuredAt: 1, _id: 1 }).limit(1).next();
    return d ? this.toDomain(d as D) : null;
  }

  async latest(userId: string, limit: number, tx?: TxContext): Promise<E[]> {
    const docs = await this.col
      .find({ userId, deletedAt: null } as Filter<D>, { session: sessionOf(tx) })
      .sort(HISTORY_SORT)
      .limit(limit)
      .toArray();
    return docs.map((d) => this.toDomain(d as D));
  }

  async listLive(userId: string, tx?: TxContext): Promise<E[]> {
    const docs = await this.col
      .find({ userId, deletedAt: null } as Filter<D>, { session: sessionOf(tx) })
      .sort({ measuredAt: 1, _id: 1 })
      .toArray();
    return docs.map((d) => this.toDomain(d as D));
  }

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ userId: 1, measuredAt: -1, _id: -1 } as Document, { name: 'userId_measuredAt_id' });
  }
}
