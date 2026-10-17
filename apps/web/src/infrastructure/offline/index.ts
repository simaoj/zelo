/**
 * Offline-first data layer (owned by the PWA agent). The composition root calls
 * `createOfflineDataLayer(http, auth)` and uses ONLY the returned { data, sync, auth }.
 */
import type { AuthPort, SyncPort, ZeloDataSource } from '@/shared/data/ports';
import {
  OfflineRuntime,
  createOfflineAuth,
  createOfflineDataSource,
  createOfflineSyncPort,
  type OfflineLayerOptions,
  type OfflineSyncPort,
} from './layer';
import { registerServiceWorker } from '@/pwa/sw-client';

export interface OfflineDataLayer {
  data: ZeloDataSource;
  sync: SyncPort;
  /** wraps AuthPort so sign-out/sign-in handle pending queue + local wipe + account switch */
  auth: AuthPort;
}

export function createOfflineDataLayer(http: ZeloDataSource, auth: AuthPort, options?: OfflineLayerOptions): OfflineDataLayer & { sync: OfflineSyncPort } {
  const rt = new OfflineRuntime(http, auth, options);
  // the composition root runs on every page (incl. sign-in): register the SW as early as possible
  if (typeof window !== 'undefined' && options?.installListeners !== false) void registerServiceWorker();
  return { data: createOfflineDataSource(rt), sync: createOfflineSyncPort(rt), auth: createOfflineAuth(rt) };
}

export {
  SignOutCancelledError,
  isSignOutCancelled,
  isOfflineSync,
  type OfflineLayerOptions,
  type OfflineSyncPort,
  type SignOutChoice,
  type SignOutHandler,
  type SignOutPrompt,
} from './layer';
export { createFetchSyncApi, type SyncApi } from './api';
export { DeviceFlags } from './flags';
