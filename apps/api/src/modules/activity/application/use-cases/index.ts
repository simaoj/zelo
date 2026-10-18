import type { ChangeLog, Clock, IdGenerator, UnitOfWork } from '../../../../shared/application/ports.js';
import type { ActivityGoalRepository, DailyStepsRepository, TimezoneReader, WorkoutRepository } from '../ports/out/index.js';
import { GetActivityToday, GetDailySteps, GetWorkoutDetails, ListWorkouts, StepsGoalUseCases, type WorkoutCursorCodec } from './activity-queries.js';
import { ReceiveHealthExport } from './receive-health-export.js';

export * from './activity-queries.js';
export * from './receive-health-export.js';

export function createActivityUseCases(d: {
  steps: DailyStepsRepository;
  workouts: WorkoutRepository;
  goals: ActivityGoalRepository;
  profiles: TimezoneReader;
  cursor: WorkoutCursorCodec;
  clock: Clock;
  ids: IdGenerator;
  changeLog: ChangeLog;
  uow: UnitOfWork;
}) {
  return {
    uow: d.uow,
    receiveHealthExport: new ReceiveHealthExport(d),
    getDailySteps: new GetDailySteps(d),
    getActivityToday: new GetActivityToday(d),
    listWorkouts: new ListWorkouts({ workouts: d.workouts, cursor: d.cursor }),
    getWorkoutDetails: new GetWorkoutDetails(d.workouts),
    stepsGoal: new StepsGoalUseCases(d),
  };
}
export type ActivityUseCases = ReturnType<typeof createActivityUseCases>;
