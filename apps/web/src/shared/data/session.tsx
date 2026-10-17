'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { Profile, SessionResponse } from '@zelo/contracts';

export interface SessionContextValue {
  session: SessionResponse;
  profile: Profile;
  setProfile(p: Profile): void;
  refreshProfile(): Promise<void>;
  /** Called when the API answers 401 during the session. */
  expire(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ value, children }: { value: SessionContextValue; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside the authenticated shell');
  return ctx;
}

export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext);
}

export function useProfile() {
  return useSession().profile;
}

export function useTimeZone(): string {
  return useSession().profile.timezone;
}
