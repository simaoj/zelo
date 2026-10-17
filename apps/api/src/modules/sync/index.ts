import type { CoreDeps, ModuleDefinition, SyncOperationHandler, SyncReader } from '../../bootstrap/module-contract.js';
import { SyncService, type ChangeFeed } from './application/sync-service.js';
import { syncRoutes } from './adapters/in/http/sync-routes.js';

export function createSyncModule(
  deps: CoreDeps & { changeFeed: ChangeFeed; readers: SyncReader[]; handlers: SyncOperationHandler[] },
): ModuleDefinition & { service: SyncService } {
  const service = new SyncService(deps.uow, deps.changeFeed, deps.idempotency, deps.readers, deps.handlers);
  return { name: 'sync', httpRoutes: syncRoutes(service), service };
}
