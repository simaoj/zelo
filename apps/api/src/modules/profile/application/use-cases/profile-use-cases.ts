import type { Profile as ProfileDto } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, TxContext, UnitOfWork } from '../../../../shared/application/ports.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { VISIBLE_MODULES, createProfile, updateProfile, type ProfileChanges, type VisibleModule } from '../../domain/profile.js';
import { toProfileDto } from '../dto.js';
import type { ProfileRepository } from '../ports/out/profile-repository.js';

export class GetProfile {
  constructor(private readonly repo: ProfileRepository) {}
  async execute(actor: Actor, tx?: TxContext): Promise<ProfileDto> {
    const p = await this.repo.findByUserId(actor.userId, tx);
    if (!p) throw new NotFoundError('Perfil');
    return toProfileDto(p);
  }
}

export class UpdateProfile {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly clock: Clock,
    private readonly changeLog: ChangeLog,
  ) {}

  async execute(actor: Actor, input: ProfileChanges & { expectedVersion: number }, tx: TxContext): Promise<ProfileDto> {
    const current = await this.repo.findByUserId(actor.userId, tx);
    if (!current) throw new NotFoundError('Perfil');
    if (current.version !== input.expectedVersion) throw new VersionConflictError(toProfileDto(current));
    const next = updateProfile(current, input, this.clock.now());
    if (!(await this.repo.updateIfVersion(next, input.expectedVersion, tx))) {
      const fresh = await this.repo.findByUserId(actor.userId, tx);
      throw new VersionConflictError(fresh ? toProfileDto(fresh) : undefined);
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'profile', id: actor.userId, op: 'upsert' });
    return toProfileDto(next);
  }
}

/** Used by identity at sign-up, inside the sign-up transaction. */
export class ProvisionProfile {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly clock: Clock,
    private readonly changeLog: ChangeLog,
  ) {}

  async execute(input: { userId: string; displayName: string; timezone: string }, tx: TxContext): Promise<void> {
    const profile = createProfile({ ...input, now: this.clock.now() });
    await this.repo.insert(profile, tx);
    await this.changeLog.record(tx, input.userId, { entity: 'profile', id: input.userId, op: 'upsert' });
  }
}

/**
 * One-off migration: makes newly introduced modules visible on EXISTING profiles (new sign-ups already
 * get every module). Each profile is updated in its own transaction with a version bump and a sync
 * change, so devices with offline mode receive the new profile. Re-running is harmless (profiles that
 * already have the modules are skipped); the migration runner additionally records a marker so a user
 * who later hides a module does not get it re-enabled.
 */
export class AddVisibleModules {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly changeLog: ChangeLog,
  ) {}

  async execute(modules: readonly VisibleModule[]): Promise<number> {
    let changed = 0;
    for (const userId of await this.repo.listUserIdsMissingModules(modules)) {
      const done = await this.uow.run(async (tx) => {
        const current = await this.repo.findByUserId(userId, tx);
        if (!current || modules.every((m) => current.visibleModules.includes(m))) return false;
        const visibleModules = VISIBLE_MODULES.filter((m) => current.visibleModules.includes(m) || modules.includes(m));
        const next = updateProfile(current, { visibleModules }, this.clock.now());
        if (!(await this.repo.updateIfVersion(next, current.version, tx))) throw new Error('profile changed concurrently');
        await this.changeLog.record(tx, userId, { entity: 'profile', id: userId, op: 'upsert' });
        return true;
      });
      if (done) changed += 1;
    }
    return changed;
  }
}
