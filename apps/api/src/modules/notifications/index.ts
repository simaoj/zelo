import type { CoreDeps, ModuleDefinition } from '../../bootstrap/module-contract.js';
import type { ProfileReader, PushSubscriptionRevoker } from '../../shared/application/cross-module-ports.js';

export function createNotificationsModule(
  _deps: CoreDeps & { profileReader: ProfileReader },
): ModuleDefinition & { pushRevoker: PushSubscriptionRevoker } {
  return { name: 'notifications', pushRevoker: { revokeForDevice: async () => {} } };
}
