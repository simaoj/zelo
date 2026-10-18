import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { ActivitySnapshotReader, ProfileReader } from '../../shared/application/cross-module-ports.js';
import { createActivityUseCases } from './application/use-cases/index.js';
import { activityRoutes, type BearerAuthenticator } from './adapters/in/http/activity-routes.js';
import { activitySyncReaders } from './adapters/in/sync/activity-sync.js';
import {
  MongoActivityGoalRepository,
  MongoDailyStepsRepository,
  MongoWorkoutRepository,
  workoutCursorCodec,
} from './adapters/out/mongodb/mongo-activity-repositories.js';

export type { BearerAuthenticator } from './adapters/in/http/activity-routes.js';
export { parseHealthExport } from './adapters/in/http/health-export/health-export-parser.js';

/**
 * Activity (steps + workouts) — data RECEIVED from Health Auto Export via POST /imports/health
 * (bearer integration token). Read-only for the user; no polling, jobs or offline mutations.
 */
export function createActivityModule(
  deps: CoreDeps & { profileReader: ProfileReader; integrationAuth: BearerAuthenticator },
): ModuleDefinition & { activitySnapshot: ActivitySnapshotReader } {
  const steps = new MongoDailyStepsRepository(deps.db);
  const workouts = new MongoWorkoutRepository(deps.db);
  const goals = new MongoActivityGoalRepository(deps.db);
  const uc = createActivityUseCases({
    steps,
    workouts,
    goals,
    profiles: deps.profileReader,
    cursor: workoutCursorCodec,
    clock: deps.clock,
    ids: deps.ids,
    changeLog: deps.changeLog,
    uow: deps.uow,
  });
  return {
    name: 'activity',
    httpRoutes: activityRoutes(uc, deps.idempotency, deps.integrationAuth),
    syncReaders: activitySyncReaders({ steps, workouts, goals, profiles: deps.profileReader, clock: deps.clock }),
    ensureIndexes: async () => {
      await steps.ensureIndexes();
      await workouts.ensureIndexes();
      await goals.ensureIndexes();
    },
    activitySnapshot: { todayFor: (userId, date, timezone) => uc.getActivityToday.execute(userId, date, timezone) },
  };
}
