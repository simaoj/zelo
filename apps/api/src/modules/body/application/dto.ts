import type { MeasurementSession as MeasurementSessionDto, WeightEntry as WeightEntryDto, WeightGoal as WeightGoalDto } from '@zelo/contracts';
import type { MeasurementSession } from '../domain/entities/measurement-session.js';
import type { WeightEntry } from '../domain/entities/weight-entry.js';
import type { WeightGoal } from '../domain/entities/weight-goal.js';

export function toWeightDto(e: WeightEntry, deltaKg: string | null): WeightEntryDto {
  return {
    id: e.id,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    measuredAt: e.measuredAt.toISOString(),
    timezone: e.timezone,
    weightKg: e.weightKg,
    notes: e.notes,
    deltaKg,
  };
}

export function toWeightGoalDto(g: WeightGoal): WeightGoalDto {
  return { targetKg: g.targetKg, version: g.version, updatedAt: g.updatedAt.toISOString() };
}

export function toMeasurementDto(s: MeasurementSession): MeasurementSessionDto {
  return {
    id: s.id,
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    measuredAt: s.measuredAt.toISOString(),
    timezone: s.timezone,
    notes: s.notes,
    values: s.values.map((v) => ({ type: v.type, side: v.side, valueCm: v.valueCm })),
  };
}
