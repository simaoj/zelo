import type { Collection, Db } from 'mongodb';
import type { NotificationJobRepository } from '../../../application/ports/out/index.js';
import type { JobStatus, NotificationJob } from '../../../domain/notification-job.js';

interface NotificationJobDoc {
  _id: string;
  userId: string;
  occurrenceId: string;
  subscriptionId: string;
  scheduledAt: Date;
  dueAt: Date;
  status: JobStatus;
  attempts: number;
  leaseUntil: Date | null;
  leaseOwner: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt?: Date;
}

export const NOTIFICATION_JOBS = 'notificationJobs';

const toJob = (d: NotificationJobDoc): NotificationJob => ({
  id: d._id,
  userId: d.userId,
  occurrenceId: d.occurrenceId,
  subscriptionId: d.subscriptionId,
  scheduledAt: d.scheduledAt,
  dueAt: d.dueAt,
  status: d.status,
  attempts: d.attempts,
  leaseUntil: d.leaseUntil,
  leaseOwner: d.leaseOwner,
});

export class MongoNotificationJobRepository implements NotificationJobRepository {
  private readonly col: Collection<NotificationJobDoc>;
  constructor(db: Db) {
    this.col = db.collection<NotificationJobDoc>(NOTIFICATION_JOBS);
  }

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ occurrenceId: 1, subscriptionId: 1 }, { unique: true, name: 'occurrenceId_subscriptionId_unique' });
    await this.col.createIndex({ status: 1, dueAt: 1 }, { name: 'status_dueAt' });
  }

  async planOnce(job: NotificationJob, now: Date): Promise<boolean> {
    try {
      const res = await this.col.updateOne(
        { occurrenceId: job.occurrenceId, subscriptionId: job.subscriptionId },
        {
          $setOnInsert: {
            _id: job.id,
            userId: job.userId,
            scheduledAt: job.scheduledAt,
            dueAt: job.dueAt,
            status: 'pending',
            attempts: 0,
            leaseUntil: null,
            leaseOwner: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        { upsert: true },
      );
      return res.upsertedCount === 1;
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false; // another planner won the race
      throw err;
    }
  }

  async claimDue(now: Date, leaseUntil: Date, owner: string): Promise<NotificationJob | null> {
    const doc = await this.col.findOneAndUpdate(
      { status: 'pending', dueAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
      { $set: { leaseUntil, leaseOwner: owner, updatedAt: now } },
      { sort: { dueAt: 1 }, returnDocument: 'after' },
    );
    return doc ? toJob(doc) : null;
  }

  async complete(id: string, owner: string, status: 'sent' | 'cancelled' | 'failed', now: Date, detail?: string): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: id, leaseOwner: owner, status: 'pending' },
      {
        $set: { status, leaseUntil: null, leaseOwner: null, updatedAt: now, finishedAt: now, lastError: detail ?? null },
        $inc: { attempts: status === 'cancelled' ? 0 : 1 },
      },
    );
    return res.modifiedCount === 1;
  }

  async retry(id: string, owner: string, attempts: number, dueAt: Date, now: Date, detail?: string): Promise<boolean> {
    const res = await this.col.updateOne(
      { _id: id, leaseOwner: owner, status: 'pending' },
      { $set: { attempts, dueAt, leaseUntil: null, leaseOwner: null, updatedAt: now, lastError: detail ?? null } },
    );
    return res.modifiedCount === 1;
  }
}
