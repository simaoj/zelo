import type { ChangeLog, Clock, IdGenerator, UnitOfWork } from '../../../shared/application/ports.js';
import type { IntakeRepository, OccurrenceRepository, RoutineRepository } from './ports/out/repositories.js';

/** Only the part of the profile module this module needs. */
export interface ProfileTimezoneReader {
  getTimezone(userId: string): Promise<string>;
}

export interface RoutineAppDeps {
  routines: RoutineRepository;
  occurrences: OccurrenceRepository;
  intakes: IntakeRepository;
  clock: Clock;
  ids: IdGenerator;
  uow: UnitOfWork;
  changeLog: ChangeLog;
  profiles: ProfileTimezoneReader;
}

/** Rolling generation window around "today" (schedule tz), spec: today−7 … today+14. */
export const WINDOW_PAST_DAYS = 7;
export const WINDOW_FUTURE_DAYS = 14;
/** Sync bootstrap occurrence window (profile tz), contract: today−7 … today+7. */
export const BOOTSTRAP_PAST_DAYS = 7;
export const BOOTSTRAP_FUTURE_DAYS = 7;
