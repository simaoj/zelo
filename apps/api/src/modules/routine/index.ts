import type { Occurrence } from '@zelo/contracts';
import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { ProfileReader } from '../../shared/application/cross-module-ports.js';
import { createRoutineUseCases } from './application/use-cases/index.js';
import { MongoIntakeRepository } from './adapters/out/mongodb/mongo-intake-repository.js';
import { MongoOccurrenceRepository } from './adapters/out/mongodb/mongo-occurrence-repository.js';
import { MongoRoutineRepository } from './adapters/out/mongodb/mongo-routine-repository.js';
import { routineRoutes } from './adapters/in/http/routine-routes.js';
import { routineSyncHandlers, routineSyncReaders } from './adapters/in/sync/routine-sync.js';
import { occurrenceHorizonJob } from './adapters/in/jobs/occurrence-horizon-job.js';

/** Public port consumed by dashboard: occurrences of a local date (PROFILE tz), ordered by scheduledAt. */
export interface OccurrenceQuery {
  listForDate(userId: string, localDate: string): Promise<Occurrence[]>;
}

export function createRoutineModule(
  deps: CoreDeps & { profileReader: ProfileReader },
): ModuleDefinition & { occurrenceQuery: OccurrenceQuery } {
  const routines = new MongoRoutineRepository(deps.db);
  const occurrences = new MongoOccurrenceRepository(deps.db);
  const intakes = new MongoIntakeRepository(deps.db);
  const uc = createRoutineUseCases({
    routines,
    occurrences,
    intakes,
    clock: deps.clock,
    ids: deps.ids,
    uow: deps.uow,
    changeLog: deps.changeLog,
    profiles: deps.profileReader,
  });
  const horizon = occurrenceHorizonJob({ routines, generate: uc.generate, uow: deps.uow });

  return {
    name: 'routine',
    httpRoutes: routineRoutes({ uc, idempotency: deps.idempotency }),
    syncReaders: routineSyncReaders(uc),
    syncHandlers: routineSyncHandlers(uc),
    ensureIndexes: async () => {
      await routines.ensureIndexes();
      await occurrences.ensureIndexes();
      await intakes.ensureIndexes();
    },
    jobs: [{ name: horizon.name, start: horizon.start }],
    occurrenceQuery: {
      listForDate: async (userId, localDate) => (await uc.listOccurrences.forDate(userId, localDate)).items,
    },
  };
}
