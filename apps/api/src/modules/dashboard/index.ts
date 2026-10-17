import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { HealthSnapshotReader, ProfileReader } from '../../shared/application/cross-module-ports.js';
import type { OccurrenceQuery } from '../routine/index.js';

export function createDashboardModule(
  _deps: CoreDeps & { profileReader: ProfileReader; snapshotReader: HealthSnapshotReader; occurrenceQuery: OccurrenceQuery },
): ModuleDefinition {
  return { name: 'dashboard' };
}
