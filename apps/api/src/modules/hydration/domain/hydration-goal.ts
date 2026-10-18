import { assertWaterMl } from './water-entry.js';

/** Optional user-defined daily target. No automatic recommendation is ever produced. */
export interface HydrationGoal {
  id: string;
  userId: string;
  dailyTargetMl: number;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export function createHydrationGoal(input: { id: string; userId: string; dailyTargetMl: number }, now: Date): HydrationGoal {
  return { id: input.id, userId: input.userId, dailyTargetMl: assertWaterMl(input.dailyTargetMl, 'dailyTargetMl'), active: true, version: 0, createdAt: now, updatedAt: now };
}

export function changeHydrationGoal(g: HydrationGoal, dailyTargetMl: number, now: Date): HydrationGoal {
  return { ...g, dailyTargetMl: assertWaterMl(dailyTargetMl, 'dailyTargetMl'), version: g.version + 1, updatedAt: now };
}
