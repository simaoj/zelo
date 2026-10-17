import type { MeasurementSession, WeightEntry } from '@zelo/contracts';
import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import { toMeasurementDto } from './application/dto.js';
import { createBodyUseCases } from './application/use-cases/index.js';
import { bodyRoutes } from './adapters/in/http/body-routes.js';
import { bodySyncHandlers, bodySyncReaders } from './adapters/in/sync/body-sync.js';
import { MongoMeasurementRepository, MongoWeightGoalRepository, MongoWeightRepository } from './adapters/out/mongodb/mongo-body-repositories.js';

/** Part of HealthSnapshotReader implemented by this module (blood pressure comes from its own module). */
export interface BodySnapshotReader {
  latestWeight(userId: string): Promise<WeightEntry | null>;
  recentWeights(userId: string, limit: number): Promise<{ measuredAt: string; weightKg: string }[]>;
  latestMeasurement(userId: string): Promise<MeasurementSession | null>;
}

export function createBodyModule(deps: CoreDeps): ModuleDefinition & { snapshot: BodySnapshotReader } {
  const weights = new MongoWeightRepository(deps.db);
  const goals = new MongoWeightGoalRepository(deps.db);
  const measurements = new MongoMeasurementRepository(deps.db);
  const uc = createBodyUseCases({ weights, goals, measurements, clock: deps.clock, ids: deps.ids, changeLog: deps.changeLog, uow: deps.uow });

  const snapshot: BodySnapshotReader = {
    async latestWeight(userId) {
      const [e] = await weights.latest(userId, 1);
      return e ? uc.presenter.present(e) : null;
    },
    async recentWeights(userId, limit) {
      const list = await weights.latest(userId, limit);
      return list.reverse().map((e) => ({ measuredAt: e.measuredAt.toISOString(), weightKg: e.weightKg }));
    },
    async latestMeasurement(userId) {
      const [s] = await measurements.latest(userId, 1);
      return s ? toMeasurementDto(s) : null;
    },
  };

  return {
    name: 'body',
    httpRoutes: bodyRoutes(uc, deps.idempotency),
    syncReaders: bodySyncReaders({ weights, goals, measurements, uc }),
    syncHandlers: bodySyncHandlers(uc),
    ensureIndexes: async () => {
      await weights.ensureIndexes();
      await measurements.ensureIndexes();
      await goals.ensureIndexes();
    },
    snapshot,
  };
}
