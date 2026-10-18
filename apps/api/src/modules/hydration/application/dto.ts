import type { HydrationGoal as HydrationGoalDto, WaterEntry as WaterEntryDto } from '@zelo/contracts';
import type { HydrationGoal } from '../domain/hydration-goal.js';
import type { WaterEntry } from '../domain/water-entry.js';

export function toWaterEntryDto(e: WaterEntry): WaterEntryDto {
  return {
    id: e.id,
    version: e.version,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    consumedAt: e.consumedAt.toISOString(),
    timezone: e.timezone,
    amountMl: e.amountMl,
    notes: e.notes,
  };
}

export function toHydrationGoalDto(g: HydrationGoal): HydrationGoalDto {
  return { dailyTargetMl: g.dailyTargetMl, version: g.version, updatedAt: g.updatedAt.toISOString() };
}
