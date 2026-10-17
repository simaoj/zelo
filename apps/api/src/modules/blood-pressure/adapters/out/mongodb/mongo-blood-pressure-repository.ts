import type { Db } from 'mongodb';
import { MongoHistoryRepository } from '../../../../../shared/adapters/mongo-history-repository.js';
import type { BloodPressureEntry } from '../../../domain/entities/blood-pressure-entry.js';
import type { BloodPressureRepository } from '../../../application/ports/out/blood-pressure-repository.js';

interface BloodPressureDoc {
  _id: string;
  userId: string;
  measuredAt: Date;
  timezone: string;
  systolic: number;
  diastolic: number;
  pulseBpm: number | null;
  notes: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class MongoBloodPressureRepository extends MongoHistoryRepository<BloodPressureDoc, BloodPressureEntry> implements BloodPressureRepository {
  constructor(db: Db) {
    super(
      db,
      'bloodPressureEntries',
      (d) => ({
        id: d._id,
        userId: d.userId,
        measuredAt: d.measuredAt,
        timezone: d.timezone,
        systolic: d.systolic,
        diastolic: d.diastolic,
        pulseBpm: d.pulseBpm ?? null,
        notes: d.notes ?? null,
        version: d.version,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        deletedAt: d.deletedAt ?? null,
      }),
      (e) => ({
        _id: e.id,
        userId: e.userId,
        measuredAt: e.measuredAt,
        timezone: e.timezone,
        systolic: e.systolic,
        diastolic: e.diastolic,
        pulseBpm: e.pulseBpm,
        notes: e.notes,
        version: e.version,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        deletedAt: e.deletedAt,
      }),
    );
  }
}
