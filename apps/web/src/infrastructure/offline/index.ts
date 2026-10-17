/**
 * Offline-first data layer (owned by the PWA agent).
 * STUB: passes through to HTTP until implemented. Signature is fixed — the composition root calls it.
 */
import type { AuthPort, SyncPort, SyncStatus, ZeloDataSource } from '@/shared/data/ports';

export interface OfflineDataLayer {
  data: ZeloDataSource;
  sync: SyncPort;
  /** wraps AuthPort so sign-out/sign-in handle pending queue + local wipe + account switch */
  auth: AuthPort;
}

export function createOfflineDataLayer(http: ZeloDataSource, auth: AuthPort): OfflineDataLayer {
  const status: SyncStatus = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    offlineEnabled: false,
    lastSyncedAt: null,
    pendingCount: 0,
    conflictCount: 0,
    errorCount: 0,
    syncing: false,
    needsReauth: false,
  };
  const sync: SyncPort = {
    getStatus: () => status,
    subscribeStatus: () => () => {},
    syncNow: async () => {},
    enableOffline: async () => {},
    disableOffline: async () => {},
    listProblemOperations: async () => [],
    resolveKeepRemote: async () => {},
    resolveReapplyLocal: async () => {},
    discardOperation: async () => {},
    clearLocalData: async () => {},
  };
  return { data: http, sync, auth };
}
