import type { BloodPressureEntry } from '@zelo/contracts';
import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import { toBloodPressureDto } from './application/dto.js';
import { createBloodPressureUseCases } from './application/use-cases/blood-pressure.js';
import { bloodPressureRoutes } from './adapters/in/http/blood-pressure-routes.js';
import { bloodPressureSyncHandlers, bloodPressureSyncReader } from './adapters/in/sync/blood-pressure-sync.js';
import { MongoBloodPressureRepository } from './adapters/out/mongodb/mongo-blood-pressure-repository.js';

export interface BloodPressureSnapshotReader {
  latestBloodPressure(userId: string): Promise<BloodPressureEntry | null>;
}

export function createBloodPressureModule(deps: CoreDeps): ModuleDefinition & { snapshot: BloodPressureSnapshotReader } {
  const repo = new MongoBloodPressureRepository(deps.db);
  const uc = createBloodPressureUseCases({ repo, clock: deps.clock, changeLog: deps.changeLog });
  return {
    name: 'blood-pressure',
    httpRoutes: bloodPressureRoutes(uc, deps.idempotency),
    syncReaders: [bloodPressureSyncReader(repo)],
    syncHandlers: bloodPressureSyncHandlers(uc),
    ensureIndexes: () => repo.ensureIndexes(),
    snapshot: {
      async latestBloodPressure(userId) {
        const [e] = await repo.latest(userId, 1);
        return e ? toBloodPressureDto(e) : null;
      },
    },
  };
}
