import type { Collection, Db } from 'mongodb';
import type { ChangeLog, SyncEntityName, TxContext } from '../application/ports.js';
import { sessionOf } from './mongo-unit-of-work.js';

export interface SyncCounterDoc {
  _id: string; // userId
  seq: number;
}

export interface ChangeDoc {
  _id: string; // `${userId}:${seq}`
  userId: string;
  seq: number;
  entity: SyncEntityName;
  entityId: string;
  op: 'upsert' | 'delete';
  at: Date;
}

export const SYNC_COUNTERS = 'syncCounters';
export const CHANGES = 'changes';

/**
 * Per-user transactional sequence. Every mutation transaction bumps `syncCounters[userId].seq`
 * (a write → concurrent transactions of the same user conflict and are retried, so committed
 * sequence numbers are ordered by commit) and appends a `changes` row.
 */
export class MongoChangeLog implements ChangeLog {
  private readonly counters: Collection<SyncCounterDoc>;
  private readonly changes: Collection<ChangeDoc>;

  constructor(db: Db) {
    this.counters = db.collection<SyncCounterDoc>(SYNC_COUNTERS);
    this.changes = db.collection<ChangeDoc>(CHANGES);
  }

  async record(
    tx: TxContext,
    userId: string,
    change: { entity: SyncEntityName; id: string; op: 'upsert' | 'delete' },
  ): Promise<void> {
    const session = sessionOf(tx);
    const counter = await this.counters.findOneAndUpdate(
      { _id: userId },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', session },
    );
    const seq = counter?.seq ?? 1;
    await this.changes.insertOne(
      { _id: `${userId}:${seq}`, userId, seq, entity: change.entity, entityId: change.id, op: change.op, at: new Date() },
      { session },
    );
  }

  async currentSeq(userId: string, tx?: TxContext): Promise<number> {
    const doc = await this.counters.findOne({ _id: userId }, { session: sessionOf(tx) });
    return doc?.seq ?? 0;
  }

  async listAfter(userId: string, afterSeq: number, limit: number, tx?: TxContext): Promise<ChangeDoc[]> {
    return this.changes
      .find({ userId, seq: { $gt: afterSeq } }, { session: sessionOf(tx) })
      .sort({ seq: 1 })
      .limit(limit)
      .toArray();
  }

  async ensureIndexes(): Promise<void> {
    await this.changes.createIndex({ userId: 1, seq: 1 }, { unique: true, name: 'userId_seq_unique' });
  }
}
