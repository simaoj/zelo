import type { Collection, Db, Decimal128 } from 'mongodb';
import type { TxContext } from '../../../../../shared/application/ports.js';
import { fromDecimal128, toDecimal128 } from '../../../../../shared/adapters/decimal128.js';
import { MongoHistoryRepository } from '../../../../../shared/adapters/mongo-history-repository.js';
import { sessionOf } from '../../../../../shared/adapters/mongo-unit-of-work.js';
import type { MeasurementSession, MeasurementType, Side } from '../../../domain/entities/measurement-session.js';
import type { WeightEntry } from '../../../domain/entities/weight-entry.js';
import type { WeightGoal } from '../../../domain/entities/weight-goal.js';
import type { MeasurementRepository, WeightGoalRepository, WeightRepository } from '../../../application/ports/out/index.js';

// ---------- weightEntries ----------

interface WeightDoc {
  _id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  weightKg: Decimal128;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export const weightMapper = {
  toDomain: (d: WeightDoc): WeightEntry => ({
    id: d._id,
    userId: d.userId,
    measuredAt: d.measuredAt,
    timezone: d.timezone,
    weightKg: fromDecimal128(d.weightKg),
    notes: d.notes ?? null,
    version: d.version,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: d.deletedAt ?? null,
  }),
  toDoc: (e: WeightEntry): WeightDoc => ({
    _id: e.id,
    userId: e.userId,
    measuredAt: e.measuredAt,
    timezone: e.timezone,
    weightKg: toDecimal128(e.weightKg),
    notes: e.notes,
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    deletedAt: e.deletedAt,
  }),
};

export class MongoWeightRepository extends MongoHistoryRepository<WeightDoc, WeightEntry> implements WeightRepository {
  constructor(db: Db) {
    super(db, 'weightEntries', weightMapper.toDomain, weightMapper.toDoc);
  }
}

// ---------- measurementSessions ----------

interface MeasurementDoc {
  _id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  notes: string | null;
  values: { type: MeasurementType; side: Side; valueCm: Decimal128 }[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class MongoMeasurementRepository extends MongoHistoryRepository<MeasurementDoc, MeasurementSession> implements MeasurementRepository {
  constructor(db: Db) {
    super(
      db,
      'measurementSessions',
      (d) => ({
        id: d._id,
        userId: d.userId,
        measuredAt: d.measuredAt,
        timezone: d.timezone,
        notes: d.notes ?? null,
        values: d.values.map((v) => ({ type: v.type, side: v.side, valueCm: fromDecimal128(v.valueCm) })),
        version: d.version,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        deletedAt: d.deletedAt ?? null,
      }),
      (s) => ({
        _id: s.id,
        userId: s.userId,
        measuredAt: s.measuredAt,
        timezone: s.timezone,
        notes: s.notes,
        values: s.values.map((v) => ({ type: v.type, side: v.side, valueCm: toDecimal128(v.valueCm) })),
        version: s.version,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        deletedAt: s.deletedAt,
      }),
    );
  }

}

// ---------- weightGoals ----------

interface WeightGoalDoc {
  _id: string;
  userId: string;
  targetKg: Decimal128;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt?: Date;
}

const goalToDomain = (d: WeightGoalDoc): WeightGoal => ({
  id: d._id,
  userId: d.userId,
  targetKg: fromDecimal128(d.targetKg),
  active: d.active,
  version: d.version,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export class MongoWeightGoalRepository implements WeightGoalRepository {
  private readonly col: Collection<WeightGoalDoc>;
  constructor(db: Db) {
    this.col = db.collection<WeightGoalDoc>('weightGoals');
  }
  async findActive(userId: string, tx?: TxContext) {
    const d = await this.col.findOne({ userId, active: true }, { session: sessionOf(tx) });
    return d ? goalToDomain(d) : null;
  }
  async insert(g: WeightGoal, tx: TxContext) {
    await this.col.insertOne(
      { _id: g.id, userId: g.userId, targetKg: toDecimal128(g.targetKg), active: g.active, version: g.version, createdAt: g.createdAt, updatedAt: g.updatedAt },
      { session: sessionOf(tx) },
    );
  }
  async updateIfVersion(g: WeightGoal, expectedVersion: number, tx: TxContext) {
    const r = await this.col.updateOne(
      { _id: g.id, userId: g.userId, version: expectedVersion, active: true },
      { $set: { targetKg: toDecimal128(g.targetKg), updatedAt: g.updatedAt }, $inc: { version: 1 } },
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
