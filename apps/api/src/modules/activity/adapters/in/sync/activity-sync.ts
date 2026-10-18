import type { SyncReader } from '../../../../../bootstrap/module-contract.js';
import { addDays, localToday } from '../../../domain/activity.js';
import { toActivityGoalDto, toDailyStepsDto, toWorkoutDto } from '../../../application/dto.js';
import type { ActivityGoalRepository, DailyStepsRepository, TimezoneReader, WorkoutRepository } from '../../../application/ports/out/index.js';
import type { Clock } from '../../../../../shared/application/ports.js';

/** Received activity is replicated read-only: readers only, no offline operation handlers. */
export const BOOTSTRAP_DAYS = 90;

export function activitySyncReaders(d: {
  steps: DailyStepsRepository;
  workouts: WorkoutRepository;
  goals: ActivityGoalRepository;
  profiles: TimezoneReader;
  clock: Clock;
}): SyncReader[] {
  const since = async (userId: string) => addDays(localToday(d.clock.now(), await d.profiles.getTimezone(userId)), -BOOTSTRAP_DAYS);
  return [
    {
      entity: 'dailySteps',
      async getById(userId, id, tx) {
        const s = await d.steps.findById(userId, id, tx);
        return s ? toDailyStepsDto(s) : null;
      },
      async listForBootstrap(userId, tx) {
        const from = await since(userId);
        return (await d.steps.listRange(userId, from, '9999-12-31', tx)).map(toDailyStepsDto);
      },
    },
    {
      entity: 'workout',
      async getById(userId, id, tx) {
        const w = await d.workouts.findById(userId, id, tx);
        return w ? toWorkoutDto(w) : null;
      },
      async listForBootstrap(userId, tx) {
        return (await d.workouts.listSince(userId, await since(userId), tx)).map(toWorkoutDto);
      },
    },
    {
      entity: 'activityGoal',
      async getById(userId, id, tx) {
        if (id !== userId) return null;
        const g = await d.goals.findActive(userId, tx);
        return g ? toActivityGoalDto(g) : null;
      },
      async listForBootstrap(userId, tx) {
        const g = await d.goals.findActive(userId, tx);
        return g ? [toActivityGoalDto(g)] : [];
      },
    },
  ];
}
