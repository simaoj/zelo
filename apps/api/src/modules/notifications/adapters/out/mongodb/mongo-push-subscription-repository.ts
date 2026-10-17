import type { Collection, Db } from 'mongodb';
import type { PushSubscription, PushSubscriptionRepository } from '../../../application/ports/out/index.js';

interface PushSubscriptionDoc {
  _id: string;
  userId: string;
  deviceId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
  updatedAt: Date;
}

export const PUSH_SUBSCRIPTIONS = 'pushSubscriptions';

const toSub = (d: PushSubscriptionDoc): PushSubscription => ({
  id: d._id,
  userId: d.userId,
  deviceId: d.deviceId,
  endpoint: d.endpoint,
  keys: d.keys,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export class MongoPushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly col: Collection<PushSubscriptionDoc>;
  constructor(db: Db) {
    this.col = db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS);
  }

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ endpoint: 1 }, { unique: true, name: 'endpoint_unique' });
    await this.col.createIndex({ userId: 1, deviceId: 1 }, { name: 'userId_deviceId' });
  }

  async upsertByEndpoint(sub: PushSubscription): Promise<PushSubscription> {
    const update = {
      $set: { userId: sub.userId, deviceId: sub.deviceId, keys: sub.keys, updatedAt: sub.updatedAt },
      $setOnInsert: { _id: sub.id, endpoint: sub.endpoint, createdAt: sub.createdAt },
    };
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await this.col.findOneAndUpdate({ endpoint: sub.endpoint }, update, { upsert: true, returnDocument: 'after' });
        return toSub(doc!);
      } catch (err) {
        // concurrent upsert of the same endpoint → retry once as an update
        if ((err as { code?: number }).code === 11000 && attempt === 0) continue;
        throw err;
      }
    }
  }

  async deleteOthersForDevice(userId: string, deviceId: string, keepId: string): Promise<void> {
    await this.col.deleteMany({ userId, deviceId, _id: { $ne: keepId } });
  }

  async deleteOwn(userId: string, id: string): Promise<boolean> {
    return (await this.col.deleteOne({ _id: id, userId })).deletedCount === 1;
  }

  async deleteByDevice(userId: string, deviceId: string): Promise<number> {
    return (await this.col.deleteMany({ userId, deviceId })).deletedCount;
  }

  async deleteById(id: string): Promise<void> {
    await this.col.deleteOne({ _id: id });
  }

  async getById(id: string): Promise<PushSubscription | null> {
    const d = await this.col.findOne({ _id: id });
    return d ? toSub(d) : null;
  }

  async listByUser(userId: string): Promise<PushSubscription[]> {
    return (await this.col.find({ userId }).toArray()).map(toSub);
  }
}
