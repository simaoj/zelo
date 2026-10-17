import type { BloodPressureEntry as Dto } from '@zelo/contracts';
import type { BloodPressureEntry } from '../domain/entities/blood-pressure-entry.js';

export function toBloodPressureDto(e: BloodPressureEntry): Dto {
  return {
    id: e.id,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    measuredAt: e.measuredAt.toISOString(),
    timezone: e.timezone,
    systolic: e.systolic,
    diastolic: e.diastolic,
    pulseBpm: e.pulseBpm,
    notes: e.notes,
  };
}
