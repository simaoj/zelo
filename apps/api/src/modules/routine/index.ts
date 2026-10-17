import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { ProfileReader } from '../../shared/application/cross-module-ports.js';
import type { Occurrence } from '@zelo/contracts';

/** Public port consumed by dashboard: occurrences of a local date (profile tz) for a user. */
export interface OccurrenceQuery {
  listForDate(userId: string, localDate: string): Promise<Occurrence[]>;
}

export function createRoutineModule(
  _deps: CoreDeps & { profileReader: ProfileReader },
): ModuleDefinition & { occurrenceQuery: OccurrenceQuery } {
  return { name: 'routine', occurrenceQuery: { listForDate: async () => [] } };
}
