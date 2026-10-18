import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { HydrationSnapshotReader, ProfileReader } from '../../shared/application/cross-module-ports.js';
import { createHydrationUseCases } from './application/use-cases/index.js';
import { hydrationRoutes } from './adapters/in/http/hydration-routes.js';
import { hydrationSyncHandlers, hydrationSyncReaders } from './adapters/in/sync/hydration-sync.js';
import { MongoHydrationGoalRepository, MongoWaterEntryRepository } from './adapters/out/mongodb/mongo-hydration-repositories.js';

export function createHydrationModule(deps: CoreDeps & { profileReader: ProfileReader }): ModuleDefinition & { hydrationSnapshot: HydrationSnapshotReader } {
  const entries = new MongoWaterEntryRepository(deps.db);
  const goals = new MongoHydrationGoalRepository(deps.db);
  const timezones = deps.profileReader;
  const uc = createHydrationUseCases({ entries, goals, timezones, clock: deps.clock, ids: deps.ids, changeLog: deps.changeLog, uow: deps.uow });

  return {
    name: 'hydration',
    httpRoutes: hydrationRoutes(uc, deps.idempotency),
    syncReaders: hydrationSyncReaders({ entries, uc, clock: deps.clock, timezones }),
    syncHandlers: hydrationSyncHandlers(uc),
    ensureIndexes: async () => {
      await entries.ensureIndexes();
      await goals.ensureIndexes();
    },
    hydrationSnapshot: {
      dayFor: (userId, date, timezone) => uc.getHydrationDay.execute(userId, date, timezone),
    },
  };
}
