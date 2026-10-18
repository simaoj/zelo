import type { ChangeLog, Clock, IdGenerator, UnitOfWork } from '../../../../shared/application/ports.js';
import type { HydrationGoalRepository, TimezoneProvider, WaterEntryRepository } from '../ports/index.js';
import { HydrationGoalUseCases } from './hydration-goal.js';
import { GetHydrationDay, GetHydrationSummary } from './summary.js';
import { DeleteWaterIntake, ListWaterEntries, RegisterWaterIntake, UpdateWaterIntake } from './water-entries.js';

export * from './water-entries.js';
export * from './hydration-goal.js';
export * from './summary.js';

export function createHydrationUseCases(d: {
  entries: WaterEntryRepository;
  goals: HydrationGoalRepository;
  timezones: TimezoneProvider;
  clock: Clock;
  ids: IdGenerator;
  changeLog: ChangeLog;
  uow: UnitOfWork;
}) {
  const goal = new HydrationGoalUseCases(d.goals, d.clock, d.ids, d.changeLog);
  return {
    uow: d.uow,
    registerWaterIntake: new RegisterWaterIntake(d.entries, d.clock, d.changeLog),
    updateWaterIntake: new UpdateWaterIntake(d.entries, d.clock, d.changeLog),
    deleteWaterIntake: new DeleteWaterIntake(d.entries, d.clock, d.changeLog),
    listWaterEntries: new ListWaterEntries(d.entries),
    hydrationGoal: goal,
    getHydrationSummary: new GetHydrationSummary(d.entries, goal, d.timezones),
    getHydrationDay: new GetHydrationDay(d.entries, goal),
  };
}
export type HydrationUseCases = ReturnType<typeof createHydrationUseCases>;
