import { ValidationError } from '../../../shared/domain/errors.js';

/** Same order as MODULES in @zelo/contracts. New sign-ups see every module. */
export const VISIBLE_MODULES = ['body', 'bloodPressure', 'hydration', 'activity', 'routine'] as const;
export type VisibleModule = (typeof VISIBLE_MODULES)[number];

export interface Profile {
  userId: string;
  displayName: string;
  timezone: string;
  visibleModules: VisibleModule[];
  remindersEnabled: boolean;
  offlineEnabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileChanges {
  displayName?: string;
  timezone?: string;
  visibleModules?: VisibleModule[];
  remindersEnabled?: boolean;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function normalizeName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 80) throw new ValidationError('Nome inválido', { displayName: ['Informe um nome com até 80 caracteres'] });
  return n;
}

export function createProfile(input: { userId: string; displayName: string; timezone: string; now: Date }): Profile {
  if (!isValidTimeZone(input.timezone)) throw new ValidationError('Fuso inválido', { timezone: ['Fuso horário inválido'] });
  return {
    userId: input.userId,
    displayName: normalizeName(input.displayName),
    timezone: input.timezone,
    visibleModules: [...VISIBLE_MODULES],
    remindersEnabled: true,
    offlineEnabled: false,
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * Applies changes, bumping version. Changing the profile timezone never touches existing
 * routine schedules (spec §6) — schedules carry their own timezone.
 */
export function updateProfile(p: Profile, changes: ProfileChanges, now: Date): Profile {
  const next: Profile = { ...p, version: p.version + 1, updatedAt: now };
  if (changes.displayName !== undefined) next.displayName = normalizeName(changes.displayName);
  if (changes.timezone !== undefined) {
    if (!isValidTimeZone(changes.timezone)) throw new ValidationError('Fuso inválido', { timezone: ['Fuso horário inválido'] });
    next.timezone = changes.timezone;
  }
  if (changes.visibleModules !== undefined) {
    next.visibleModules = VISIBLE_MODULES.filter((m) => changes.visibleModules!.includes(m));
  }
  if (changes.remindersEnabled !== undefined) next.remindersEnabled = changes.remindersEnabled;
  return next;
}
