import type { Profile as ProfileDto } from '@zelo/contracts';
import type { Profile } from '../domain/profile.js';

export function toProfileDto(p: Profile): ProfileDto {
  return {
    userId: p.userId,
    displayName: p.displayName,
    timezone: p.timezone,
    visibleModules: [...p.visibleModules],
    remindersEnabled: p.remindersEnabled,
    version: p.version,
    updatedAt: p.updatedAt.toISOString(),
  };
}
