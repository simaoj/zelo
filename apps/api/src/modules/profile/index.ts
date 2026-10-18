import type { CoreDeps, ModuleDefinition, SyncReader } from '../../bootstrap/module-contract.js';
import type { ProfileReader } from '../../shared/application/cross-module-ports.js';
import type { TxContext } from '../../shared/application/ports.js';
import { toProfileDto } from './application/dto.js';
import { AddVisibleModules, GetProfile, ProvisionProfile, UpdateProfile } from './application/use-cases/profile-use-cases.js';
import { MongoProfileRepository } from './adapters/out/mongodb/mongo-profile-repository.js';
import { profileRoutes } from './adapters/in/http/profile-routes.js';

/** Port used by identity at sign-up to create the profile in the same transaction. */
export interface ProfileProvisioner {
  provision(input: { userId: string; displayName: string; timezone: string }, tx: TxContext): Promise<void>;
}

export function createProfileModule(
  deps: CoreDeps,
): ModuleDefinition & { profileReader: ProfileReader; profileProvisioner: ProfileProvisioner } {
  const repo = new MongoProfileRepository(deps.db);
  const getProfile = new GetProfile(repo);
  const updateProfile = new UpdateProfile(repo, deps.clock, deps.changeLog);
  const provision = new ProvisionProfile(repo, deps.clock, deps.changeLog);
  const addVisibleModules = new AddVisibleModules(repo, deps.uow, deps.clock, deps.changeLog);

  const profileReader: ProfileReader = {
    async getTimezone(userId) {
      return (await repo.findByUserId(userId))?.timezone ?? 'America/Sao_Paulo';
    },
    async getDisplayName(userId) {
      return (await repo.findByUserId(userId))?.displayName ?? '';
    },
    async remindersEnabled(userId) {
      return (await repo.findByUserId(userId))?.remindersEnabled ?? false;
    },
  };

  const reader: SyncReader = {
    entity: 'profile',
    async getById(userId, id, tx) {
      if (id !== userId) return null;
      const p = await repo.findByUserId(userId, tx);
      return p ? toProfileDto(p) : null;
    },
    async listForBootstrap(userId, tx) {
      const p = await repo.findByUserId(userId, tx);
      return p ? [toProfileDto(p)] : [];
    },
  };

  return {
    name: 'profile',
    httpRoutes: profileRoutes({ getProfile, updateProfile, idempotency: deps.idempotency }),
    syncReaders: [reader],
    ensureIndexes: () => repo.ensureIndexes(),
    migrations: [
      {
        id: '2026-10-18-profile-visible-hydration-activity',
        description: 'show the new Água (hydration) and Atividade (activity) modules on existing profiles',
        run: async () => {
          const n = await addVisibleModules.execute(['hydration', 'activity']);
          return `${n} profile(s) updated`;
        },
      },
    ],
    profileReader,
    profileProvisioner: { provision: (input, tx) => provision.execute(input, tx) },
  };
}
