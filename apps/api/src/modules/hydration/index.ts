import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { HydrationSnapshotReader, ProfileReader } from '../../shared/application/cross-module-ports.js';

/** STUB — full implementation in progress. */
export function createHydrationModule(deps: CoreDeps & { profileReader: ProfileReader }): ModuleDefinition & { hydrationSnapshot: HydrationSnapshotReader } {
  void deps;
  return {
    name: 'hydration',
    hydrationSnapshot: {
      async dayFor() {
        return { totalMl: null, entryCount: 0, goal: null, lastEntryAt: null };
      },
    },
  };
}
