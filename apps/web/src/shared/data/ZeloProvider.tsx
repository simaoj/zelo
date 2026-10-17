'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthPort, SyncPort, ZeloDataSource } from './ports';

export interface ZeloServices {
  data: ZeloDataSource;
  sync: SyncPort;
  auth: AuthPort;
}

const ZeloContext = createContext<ZeloServices | null>(null);

/**
 * Provides the composed data layer to client components. Services are created after
 * mount (browser only: IndexedDB, cookies), so children render once they exist.
 */
export function ZeloProvider({
  children,
  create,
  fallback = null,
}: {
  children: ReactNode;
  create: () => ZeloServices;
  fallback?: ReactNode;
}) {
  const [services, setServices] = useState<ZeloServices | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only services
    setServices(create());
  }, [create]);
  if (!services) return <>{fallback}</>;
  return <ZeloContext.Provider value={services}>{children}</ZeloContext.Provider>;
}

/** Test helper / explicit injection. */
export function ZeloServicesProvider({ value, children }: { value: ZeloServices; children: ReactNode }) {
  return <ZeloContext.Provider value={value}>{children}</ZeloContext.Provider>;
}

export function useZelo(): ZeloServices {
  const ctx = useContext(ZeloContext);
  if (!ctx) throw new Error('useZelo must be used inside <ZeloProvider>');
  return ctx;
}

export function useOptionalZelo(): ZeloServices | null {
  return useContext(ZeloContext);
}
