/**
 * Public surface of the PWA/offline feature. The UI imports ONLY from here
 * (and `@/pwa/metadata` from the root layout).
 */
export { SyncStatusBadge } from './components/SyncStatusBadge';
export { ConflictCenter } from './components/ConflictCenter';
export { InstallPrompt } from './components/InstallPrompt';
export { UpdateBanner } from './components/UpdateBanner';
export { OfflineSettings } from './components/OfflineSettings';
export { PushSettings } from './components/PushSettings';
export { PwaProvider, usePwa, useSyncStatus, type PwaContextValue, type PwaProviderProps } from './PwaProvider';
export { pwaGuards, useEditingGuard } from './guards';
export { getDeviceId } from './device';
export { registerServiceWorker } from './sw-client';
export { SignOutCancelledError, isSignOutCancelled } from '@/infrastructure/offline';
