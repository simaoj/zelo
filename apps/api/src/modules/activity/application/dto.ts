import type { ActivityGoal as ActivityGoalDto, DailySteps as DailyStepsDto, Workout as WorkoutDto } from '@zelo/contracts';
import type { ActivityGoal, DailySteps, Workout } from '../domain/activity.js';

export function toDailyStepsDto(s: DailySteps): DailyStepsDto {
  return {
    id: s.id,
    provider: s.provider,
    localDate: s.localDate,
    count: s.count,
    offsetMinutes: s.offsetMinutes,
    receivedAt: s.receivedAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
  };
}

export function toWorkoutDto(w: Workout): WorkoutDto {
  return {
    id: w.id,
    provider: w.provider,
    name: w.name,
    startedAt: w.startedAt.toISOString(),
    endedAt: w.endedAt.toISOString(),
    startOffsetMinutes: w.startOffsetMinutes,
    localDate: w.localDate,
    durationSeconds: w.durationSeconds,
    distanceMeters: w.distanceMeters,
    activeEnergyKcal: w.activeEnergyKcal,
    receivedAt: w.receivedAt.toISOString(),
    createdAt: w.createdAt.toISOString(),
  };
}

export function toActivityGoalDto(g: ActivityGoal): ActivityGoalDto {
  return { dailyStepsTarget: g.dailyStepsTarget, version: g.version, updatedAt: g.updatedAt.toISOString() };
}
