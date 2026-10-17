'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthPort, SyncPort, SyncStatus, ZeloDataSource } from '@/shared/data/ports';
import { isOfflineSync, type SignOutChoice, type SignOutPrompt } from '@/infrastructure/offline';
import { registerServiceWorker } from './sw-client';
import { SignOutDialog } from './components/SignOutDialog';

export interface PwaContextValue {
  sync?: SyncPort;
  data?: ZeloDataSource;
  auth?: AuthPort;
  conflictsOpen: boolean;
  openConflicts: () => void;
  closeConflicts: () => void;
}
const PwaContext = createContext<PwaContextValue>({
  conflictsOpen: false,
  openConflicts: () => undefined,
  closeConflicts: () => undefined,
});
export const usePwa = () => useContext(PwaContext);

const noopSubscribe = () => () => undefined;
const nullStatus = () => null;

/** Live SyncStatus (null when no SyncPort is provided). */
export function useSyncStatus(): SyncStatus | null {
  const { sync } = usePwa();
  return useSyncExternalStore(sync?.subscribeStatus ?? noopSubscribe, sync?.getStatus ?? nullStatus, nullStatus);
}

export interface PwaProviderProps {
  sync?: SyncPort;
  data?: ZeloDataSource;
  auth?: AuthPort;
  children: ReactNode;
}

/**
 * Wraps the authenticated shell: registers the service worker (production only), exposes the
 * PWA context for SyncStatusBadge / ConflictCenter / OfflineSettings / PushSettings / UpdateBanner,
 * and renders the sign-out confirmation used by the wrapped AuthPort.signOut().
 */
export function PwaProvider({ sync, data, auth, children }: PwaProviderProps) {
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [prompt, setPrompt] = useState<SignOutPrompt | null>(null);
  const resolver = useRef<((c: SignOutChoice) => void) | null>(null);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (!isOfflineSync(sync)) return;
    sync.setSignOutHandler(
      (p) =>
        new Promise<SignOutChoice>((resolve) => {
          resolver.current = resolve;
          setPrompt(p);
        }),
    );
    return () => sync.setSignOutHandler(null);
  }, [sync]);

  const choose = useCallback((c: SignOutChoice) => {
    const r = resolver.current;
    resolver.current = null;
    setPrompt(null);
    r?.(c);
  }, []);

  const value = useMemo<PwaContextValue>(
    () => ({
      sync,
      data,
      auth,
      conflictsOpen,
      openConflicts: () => setConflictsOpen(true),
      closeConflicts: () => setConflictsOpen(false),
    }),
    [sync, data, auth, conflictsOpen],
  );

  return (
    <PwaContext.Provider value={value}>
      {children}
      <SignOutDialog prompt={prompt} onChoose={choose} />
    </PwaContext.Provider>
  );
}
