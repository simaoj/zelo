import { MongoServerError, type Collection, type Db, type Filter } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { sessionOf } from '../../../../../shared/adapters/mongo-unit-of-work.js';
import type { ActivityGoal, ActivityProvider, DailySteps, StepsValues, Workout, WorkoutValues } from '../../../domain/activity.js';
import {
  ConcurrentUpsertError,
  type ActivityGoalRepository,
  type DailyStepsRepository,
  type UpsertResult,
  type WorkoutPageParams,
  type WorkoutPosition,
  type WorkoutRepository,
} from '../../../application/ports/out/index.js';
import type { WorkoutCursorCodec } from '../../../application/use-cases/activity-queries.js';

export const DAILY_STEPS = 'dailySteps';
export const WORKOUTS = 'workouts';
export const ACTIVITY_GOALS = 'activityGoals';

function isDuplicateKey(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 11000;
}

async function translateDuplicate<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isDuplicateKey(err)) throw new ConcurrentUpsertError();
    throw err;
  }
}

// ---------- dailySteps ----------

interface DailyStepsDoc {
  _id: string;
  userId: string;
  provider: ActivityProvider;
  localDate: string;
  count: number;
  offsetMinutes: number;
  receivedAt: Date;
  createdAt: Date;
}

const stepsToDomain = (d: DailyStepsDoc): DailySteps => ({
  id: d._id,
  userId: d.userId,
  provider: d.provider,
  localDate: d.localDate,
  count: d.count,
  offsetMinutes: d.offsetMinutes,
  receivedAt: d.receivedAt,
  createdAt: d.createdAt,
});

export class MongoDailyStepsRepository implements DailyStepsRepository {
  private readonly col: Collection<DailyStepsDoc>;
  constructor(db: Db) {
    this.col = db.collection<DailyStepsDoc>(DAILY_STEPS);
  }

  async upsert(userId: string, provider: ActivityProvider, v: StepsValues, receivedAt: Date, newId: string, tx: TxContext): Promise<UpsertResult<DailySteps>> {
    const before = await translateDuplicate(() =>
      this.col.findOneAndUpdate(
        { userId, provider, localDate: v.localDate },
        { $set: { count: v.count, offsetMinutes: v.offsetMinutes, receivedAt }, $setOnInsert: { _id: newId, createdAt: receivedAt } },
        { upsert: true, returnDocument: 'before', session: sessionOf(tx) },
      ),
    );
    return before ? { before: stepsToDomain(before), id: before._id } : { before: null, id: newId };
  }

  async findById(userId: string, id: string, tx?: TxContext) {
    const d = await this.col.findOne({ _id: id, userId }, { session: sessionOf(tx) });
    return d ? stepsToDomain(d) : null;
  }

  async findByDate(userId: string, localDate: string, tx?: TxContext) {
    // single provider in this version
    const d = await this.col.findOne({ userId, localDate }, { session: sessionOf(tx) });
    return d ? stepsToDomain(d) : null;
  }

  async listRange(userId: string, from: string, to: string, tx?: TxContext) {
    const docs = await this.col.find({ userId, localDate: { $gte: from, $lte: to } }, { session: sessionOf(tx) }).sort({ localDate: 1 }).toArray();
    return docs.map(stepsToDomain);
  }

  async lastReceivedAt(userId: string) {
    const d = await this.col.find({ userId }).sort({ receivedAt: -1 }).limit(1).next();
    return d?.receivedAt ?? null;
  }

  async ensureIndexes() {
    await this.col.createIndex({ userId: 1, provider: 1, localDate: 1 }, { unique: true, name: 'userId_provider_localDate_unique' });
    await this.col.createIndex({ userId: 1, localDate: 1 }, { name: 'userId_localDate' });
    await this.col.createIndex({ userId: 1, receivedAt: -1 }, { name: 'userId_receivedAt' });
  }
}

// ---------- workouts ----------

interface WorkoutDoc {
  _id: string;
  userId: string;
  provider: ActivityProvider;
  externalId: string;
  name: string;
  startedAt: Date;
  endedAt: Date;
  startOffsetMinutes: number;
  localDate: string;
  durationSeconds: number;
  distanceMeters: number | null;
  activeEnergyKcal: number | null;
  receivedAt: Date;
  createdAt: Date;
}

const workoutToDomain = (d: WorkoutDoc): Workout => ({
  id: d._id,
  userId: d.userId,
  provider: d.provider,
  externalId: d.externalId,
  name: d.name,
  startedAt: d.startedAt,
  endedAt: d.endedAt,
  startOffsetMinutes: d.startOffsetMinutes,
  localDate: d.localDate,
  durationSeconds: d.durationSeconds,
  distanceMeters: d.distanceMeters ?? null,
  activeEnergyKcal: d.activeEnergyKcal ?? null,
  receivedAt: d.receivedAt,
  createdAt: d.createdAt,
});

export class MongoWorkoutRepository implements WorkoutRepository {
  private readonly col: Collection<WorkoutDoc>;
  constructor(db: Db) {
    this.col = db.collection<WorkoutDoc>(WORKOUTS);
  }

  async upsert(userId: string, provider: ActivityProvider, v: WorkoutValues, receivedAt: Date, newId: string, tx: TxContext): Promise<UpsertResult<Workout>> {
    const before = await translateDuplicate(() =>
      this.col.findOneAndUpdate(
        { userId, provider, externalId: v.externalId },
        {
          $set: {
            name: v.name,
            startedAt: v.startedAt,
            endedAt: v.endedAt,
            startOffsetMinutes: v.startOffsetMinutes,
            localDate: v.localDate,
            durationSeconds: v.durationSeconds,
            distanceMeters: v.distanceMeters,
            activeEnergyKcal: v.activeEnergyKcal,
            receivedAt,
          },
          $setOnInsert: { _id: newId, createdAt: receivedAt },
        },
        { upsert: true, returnDocument: 'before', session: sessionOf(tx) },
      ),
    );
    return before ? { before: workoutToDomain(before), id: before._id } : { before: null, id: newId };
  }

  async findById(userId: string, id: string, tx?: TxContext) {
    const d = await this.col.findOne({ _id: id, userId }, { session: sessionOf(tx) });
    return d ? workoutToDomain(d) : null;
  }

  async page(userId: string, p: WorkoutPageParams) {
    const and: Filter<WorkoutDoc>[] = [{ userId }];
    if (p.from || p.to) {
      const range: { $gte?: string; $lte?: string } = {};
      if (p.from) range.$gte = p.from;
      if (p.to) range.$lte = p.to;
      and.push({ localDate: range });
    }
    if (p.name) and.push({ name: p.name });
    if (p.after) {
      and.push({ $or: [{ startedAt: { $lt: p.after.startedAt } }, { startedAt: p.after.startedAt, _id: { $lt: p.after.id } }] });
    }
    const docs = await this.col.find({ $and: and }).sort({ startedAt: -1, _id: -1 }).limit(p.limit + 1).toArray();
    return docs.map(workoutToDomain);
  }

  async distinctNames(userId: string) {
    const names = await this.col.distinct('name', { userId });
    return (names as string[]).sort((a, b) => a.localeCompare(b));
  }

  async listByLocalDate(userId: string, localDate: string) {
    return (await this.col.find({ userId, localDate }).sort({ startedAt: 1 }).toArray()).map(workoutToDomain);
  }

  async listSince(userId: string, fromLocalDate: string, tx?: TxContext) {
    const docs = await this.col.find({ userId, localDate: { $gte: fromLocalDate } }, { session: sessionOf(tx) }).sort({ startedAt: -1, _id: -1 }).toArray();
    return docs.map(workoutToDomain);
  }

  async lastReceivedAt(userId: string) {
    const d = await this.col.find({ userId }).sort({ receivedAt: -1 }).limit(1).next();
    return d?.receivedAt ?? null;
  }

  async ensureIndexes() {
    await this.col.createIndex({ userId: 1, provider: 1, externalId: 1 }, { unique: true, name: 'userId_provider_externalId_unique' });
    await this.col.createIndex({ userId: 1, startedAt: -1, _id: -1 }, { name: 'userId_startedAt_id' });
    await this.col.createIndex({ userId: 1, localDate: 1 }, { name: 'userId_localDate' });
    await this.col.createIndex({ userId: 1, receivedAt: -1 }, { name: 'userId_receivedAt' });
  }
}

/** Opaque cursor for (startedAt desc, _id desc). */
export const workoutCursorCodec: WorkoutCursorCodec = {
  encode: (p: WorkoutPosition) => Buffer.from(JSON.stringify({ s: p.startedAt.toISOString(), i: p.id })).toString('base64url'),
  decode: (cursor: string) => {
    try {
      const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { s?: unknown; i?: unknown };
      if (typeof raw.s !== 'string' || typeof raw.i !== 'string') return null;
      const d = new Date(raw.s);
      return Number.isNaN(d.getTime()) ? null : { startedAt: d, id: raw.i };
    } catch {
      return null;
    }
  },
};

// ---------- activityGoals ----------

interface ActivityGoalDoc {
  _id: string;
  userId: string;
  dailyStepsTarget: number;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt?: Date;
}

const goalToDomain = (d: ActivityGoalDoc): ActivityGoal => ({
  id: d._id,
  userId: d.userId,
  dailyStepsTarget: d.dailyStepsTarget,
  active: d.active,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export class MongoActivityGoalRepository implements ActivityGoalRepository {
  private readonly col: Collection<ActivityGoalDoc>;
  constructor(db: Db) {
    this.col = db.collection<ActivityGoalDoc>(ACTIVITY_GOALS);
  }
  async findActive(userId: string, tx?: TxContext) {
    const d = await this.col.findOne({ userId, active: true }, { session: sessionOf(tx) });
    return d ? goalToDomain(d) : null;
  }
  async insert(g: ActivityGoal, tx: TxContext) {
    await this.col.insertOne(
      { _id: g.id, userId: g.userId, dailyStepsTarget: g.dailyStepsTarget, active: g.active, version: g.version, createdAt: g.createdAt, updatedAt: g.updatedAt },
      { session: sessionOf(tx) },
    );
  }
  async updateIfVersion(g: ActivityGoal, expectedVersion: number, tx: TxContext) {
    const r = await this.col.updateOne(
      { _id: g.id, userId: g.userId, version: expectedVersion, active: true },
      { $set: { dailyStepsTarget: g.dailyStepsTarget, updatedAt: g.updatedAt }, $inc: { version: 1 } },
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
