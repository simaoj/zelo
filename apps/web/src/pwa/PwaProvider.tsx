'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { AuthPort, SyncPort, ZeloDataSource } from '@/shared/data/ports';

export interface PwaContextValue {
  sync?: SyncPort;
  data?: ZeloDataSource;
  auth?: AuthPort;
}
const PwaContext = createContext<PwaContextValue>({});
export const usePwa = () => useContext(PwaContext);

export interface PwaProviderProps extends PwaContextValue {
  children: ReactNode;
}

export function PwaProvider({ sync, data, auth, children }: PwaProviderProps) {
  return <PwaContext.Provider value={{ sync, data, auth }}>{children}</PwaContext.Provider>;
}
