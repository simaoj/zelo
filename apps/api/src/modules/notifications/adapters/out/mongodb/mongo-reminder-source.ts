import type { Db, Document } from 'mongodb';
import type { ReminderCandidate, ReminderSource } from '../../../application/ports/out/index.js';
import type { ReminderState } from '../../../domain/notification-job.js';

/**
 * Read-only adapter over the routine module's persistence (occurrences, scheduleVersions,
 * routineItems, intakeRecords). The notifications module never writes these collections and
 * the module factory contract gives it no routine port, so this adapter is the single,
 * documented place coupling to that schema (same bounded team/owner).
 * Live intakes are marked with `active: true` (see routine's MongoIntakeRepository).
 */
export class MongoReminderSource implements ReminderSource {
  constructor(private readonly db: Db) {}

  async listUpcoming(from: Date, to: Date): Promise<ReminderCandidate[]> {
    const pipeline: Document[] = [
      { $match: { cancelledAt: null, scheduledAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'scheduleVersions', localField: 'scheduleVersionId', foreignField: '_id', as: 'v' } },
      { $match: { 'v.reminderEnabled': true } },
      { $lookup: { from: 'routineItems', localField: 'itemId', foreignField: '_id', as: 'i' } },
      { $match: { 'i.archivedAt': null, 'i.0': { $exists: true } } },
      {
        $lookup: {
          from: 'intakeRecords',
          let: { oid: '$_id' },
          pipeline: [{ $match: { $expr: { $eq: ['$occurrenceId', '$$oid'] }, active: true } }, { $limit: 1 }],
          as: 'decision',
        },
      },
      { $match: { decision: { $size: 0 } } },
      { $project: { _id: 1, userId: 1, scheduledAt: 1 } },
    ];
    const rows = await this.db.collection('occurrences').aggregate<{ _id: string; userId: string; scheduledAt: Date }>(pipeline).toArray();
    return rows.map((r) => ({ occurrenceId: r._id, userId: r.userId, scheduledAt: r.scheduledAt }));
  }

  async getState(occurrenceId: string): Promise<ReminderState | null> {
    const occ = await this.db
      .collection<{ _id: string; userId: string; itemId: string; scheduleVersionId: string; scheduledAt: Date; cancelledAt: Date | null }>('occurrences')
      .findOne({ _id: occurrenceId });
    if (!occ) return null;
    const [version, item, decision] = await Promise.all([
      this.db.collection<{ _id: string; reminderEnabled: boolean }>('scheduleVersions').findOne({ _id: occ.scheduleVersionId, userId: occ.userId }),
      this.db.collection<{ _id: string; archivedAt: Date | null }>('routineItems').findOne({ _id: occ.itemId, userId: occ.userId }),
      this.db.collection('intakeRecords').findOne({ occurrenceId, userId: occ.userId, active: true }, { projection: { _id: 1 } }),
    ]);
    return {
      userId: occ.userId,
      scheduledAt: occ.scheduledAt,
      cancelled: occ.cancelledAt !== null,
      decided: decision !== null,
      itemArchived: !item || item.archivedAt !== null,
      reminderEnabled: version?.reminderEnabled === true,
    };
  }
}
