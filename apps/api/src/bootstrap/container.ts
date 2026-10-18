/**
 * Composition root: builds the shared kernel (CoreDeps) and every module, wiring the
 * cross-module ports. Used by main.ts (HTTP), worker.ts (jobs), migrate.ts and tests.
 */
import { MongoClient, type Db } from 'mongodb';
import type { HealthSnapshotReader } from '../shared/application/cross-module-ports.js';
import type { Clock, IdGenerator } from '../shared/application/ports.js';
import { MongoChangeLog } from '../shared/adapters/mongo-change-log.js';
import { MongoIdempotentExecutor } from '../shared/adapters/mongo-idempotency.js';
import { MongoUnitOfWork } from '../shared/adapters/mongo-unit-of-work.js';
import { SystemClock } from '../shared/adapters/system-clock.js';
import { UuidGenerator } from '../shared/adapters/uuid-generator.js';
import type { SessionResolver } from '../shared/http/auth.js';
import { createBloodPressureModule } from '../modules/blood-pressure/index.js';
import { createBodyModule } from '../modules/body/index.js';
import { createDashboardModule } from '../modules/dashboard/index.js';
import { createIdentityModule, NodemailerMailer } from '../modules/identity/index.js';
import type { Mailer, PasswordHasher } from '../modules/identity/application/ports/out/index.js';
import { createNotificationsModule } from '../modules/notifications/index.js';
import { createProfileModule } from '../modules/profile/index.js';
import { createRoutineModule } from '../modules/routine/index.js';
import { createSyncModule } from '../modules/sync/index.js';
import type { AppConfig } from './config.js';
import type { CoreDeps, ModuleDefinition } from './module-contract.js';

export interface Container {
  config: AppConfig;
  client: MongoClient;
  db: Db;
  core: CoreDeps;
  /** all modules, in registration order (identity first) */
  modules: ModuleDefinition[];
  sessionResolver: SessionResolver;
  changeLog: MongoChangeLog;
  idempotency: MongoIdempotentExecutor;
  /** creates every index (idempotent) */
  ensureIndexes(): Promise<void>;
  close(): Promise<void>;
}

export interface ContainerOverrides {
  client?: MongoClient;
  dbName?: string;
  clock?: Clock;
  ids?: IdGenerator;
  mailer?: Mailer;
  hasher?: PasswordHasher;
}

export async function createContainer(config: AppConfig, overrides: ContainerOverrides = {}): Promise<Container> {
  const ownsClient = !overrides.client;
  const client = overrides.client ?? new MongoClient(config.mongoUri, { appName: 'zelo-api' });
  if (ownsClient) await client.connect();
  const db = overrides.dbName ? client.db(overrides.dbName) : config.mongoDb ? client.db(config.mongoDb) : client.db();

  const clock = overrides.clock ?? new SystemClock();
  const ids = overrides.ids ?? new UuidGenerator();
  const uow = new MongoUnitOfWork(client);
  const changeLog = new MongoChangeLog(db);
  const idempotency = new MongoIdempotentExecutor(db, uow, clock, ids);
  const core: CoreDeps = { db, clock, ids, uow, changeLog, idempotency };

  const profile = createProfileModule(core);
  const notifications = createNotificationsModule({ ...core, profileReader: profile.profileReader, vapid: config.vapid });
  const routine = createRoutineModule({ ...core, profileReader: profile.profileReader });
  const body = createBodyModule(core);
  const bloodPressure = createBloodPressureModule(core);
  const snapshotReader: HealthSnapshotReader = {
    latestWeight: (u) => body.snapshot.latestWeight(u),
    recentWeights: (u, n) => body.snapshot.recentWeights(u, n),
    latestMeasurement: (u) => body.snapshot.latestMeasurement(u),
    latestBloodPressure: (u) => bloodPressure.snapshot.latestBloodPressure(u),
  };
  const dashboard = createDashboardModule({ ...core, profileReader: profile.profileReader, snapshotReader, occurrenceQuery: routine.occurrenceQuery });
  const identity = createIdentityModule({
    ...core,
    profileProvisioner: profile.profileProvisioner,
    pushRevoker: notifications.pushRevoker,
    mailer: overrides.mailer ?? new NodemailerMailer(config.smtpUrl, config.mailFrom),
    ...(overrides.hasher ? { hasher: overrides.hasher } : {}),
    publicAppUrl: config.publicAppUrl,
    cookieSecure: config.cookieSecure,
    ...(config.rateLimit.enabled ? { authRateLimit: config.rateLimit.authMax } : {}),
  });

  const feature: ModuleDefinition[] = [identity, profile, body, bloodPressure, routine, dashboard, notifications];
  const sync = createSyncModule({
    ...core,
    changeFeed: changeLog,
    readers: feature.flatMap((m) => m.syncReaders ?? []),
    handlers: feature.flatMap((m) => m.syncHandlers ?? []),
  });
  const modules = [...feature, sync];

  return {
    config,
    client,
    db,
    core,
    modules,
    sessionResolver: identity.sessionResolver,
    changeLog,
    idempotency,
    async ensureIndexes() {
      await changeLog.ensureIndexes();
      await idempotency.ensureIndexes();
      for (const m of modules) await m.ensureIndexes?.();
    },
    async close() {
      if (ownsClient) await client.close();
    },
  };
}
