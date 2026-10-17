/**
 * Public surface of the PWA/offline feature. Owned by the PWA agent; the UI imports ONLY from here.
 * (Initial stubs — the PWA agent replaces the implementations, keeping these export names/props.)
 */
export { SyncStatusBadge } from './components/SyncStatusBadge';
export { ConflictCenter } from './components/ConflictCenter';
export { InstallPrompt } from './components/InstallPrompt';
export { UpdateBanner } from './components/UpdateBanner';
export { OfflineSettings } from './components/OfflineSettings';
export { PushSettings } from './components/PushSettings';
export { PwaProvider } from './PwaProvider';
