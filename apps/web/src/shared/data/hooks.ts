'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DataError, type SyncStatus, type ZeloDataSource } from './ports';
import { useZelo } from './ZeloProvider';
import { useOptionalSession } from './session';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  /** refetch; keeps current data while loading */
  reload: () => void;
}

/**
 * Loads data through the ZeloDataSource and refetches whenever the data source
 * notifies a change (`subscribe`). `key` identifies the query: changing it refetches.
 */
export function useResource<T>(key: string | null, fetcher: (data: ZeloDataSource) => Promise<T>): Resource<T> {
  const { data: ds } = useZelo();
  const session = useOptionalSession();
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: unknown; loading: boolean }>({
    key,
    data: undefined,
    error: null,
    loading: key !== null,
  });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  const seq = useRef(0);
  const expire = session?.expire;

  const run = useCallback(() => {
    if (key === null) return;
    const my = ++seq.current;
    setState((s) => ({ ...s, key, loading: true, ...(s.key !== key ? { data: undefined, error: null } : {}) }));
    fetcherRef
      .current(ds)
      .then((value) => {
        if (my === seq.current) setState({ key, data: value, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (my !== seq.current) return;
        if (error instanceof DataError && error.status === 401) expire?.();
        setState((s) => ({ ...s, key, error, loading: false }));
      });
  }, [ds, key, expire]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetching on key change
    run();
    return ds.subscribe(() => run());
  }, [ds, run]);

  const stale = state.key !== key;
  return {
    data: stale ? undefined : state.data,
    error: stale ? null : state.error,
    loading: stale ? key !== null : state.loading,
    reload: run,
  };
}

const OFFLINE_STATUS: SyncStatus = {
  online: true,
  offlineEnabled: false,
  lastSyncedAt: null,
  pendingCount: 0,
  conflictCount: 0,
  errorCount: 0,
  syncing: false,
  needsReauth: false,
};

export function useSyncStatus(): SyncStatus {
  const { sync } = useZelo();
  return useSyncExternalStore(
    (cb) => sync.subscribeStatus(() => cb()),
    () => sync.getStatus(),
    () => OFFLINE_STATUS,
  );
}

/** Online/offline flag of the browser. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
