import type { TxContext } from '../../../../../shared/application/ports.js';
import type { Profile } from '../../../domain/profile.js';

export interface ProfileRepository {
  findByUserId(userId: string, tx?: TxContext): Promise<Profile | null>;
  insert(profile: Profile, tx: TxContext): Promise<void>;
  /** Atomic `{userId, version: expectedVersion}` replace; false if version mismatch. */
  updateIfVersion(profile: Profile, expectedVersion: number, tx: TxContext): Promise<boolean>;
}
