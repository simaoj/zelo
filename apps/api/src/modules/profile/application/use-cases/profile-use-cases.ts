import type { Profile as ProfileDto } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, TxContext } from '../../../../shared/application/ports.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { createProfile, updateProfile, type ProfileChanges } from '../../domain/profile.js';
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
