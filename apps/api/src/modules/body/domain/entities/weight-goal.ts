import { positiveDecimal } from '../value-objects/decimal.js';

/** Optional user-defined target. No automatic recommendation is ever produced. */
export interface WeightGoal {
  id: string;
  userId: string;
  targetKg: string;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function createWeightGoal(input: { id: string; userId: string; targetKg: string }, now: Date): WeightGoal {
  return { id: input.id, userId: input.userId, targetKg: positiveDecimal(input.targetKg, 2, 'targetKg'), active: true, version: 0, createdAt: now, updatedAt: now };
}

export function changeWeightGoal(g: WeightGoal, targetKg: string, now: Date): WeightGoal {
  return { ...g, targetKg: positiveDecimal(targetKg, 2, 'targetKg'), version: g.version + 1, updatedAt: now };
}
