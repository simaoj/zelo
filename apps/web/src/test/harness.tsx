import type { ReactNode } from 'react';
import { vi } from 'vitest';
import type { Profile } from '@zelo/contracts';
import type { AuthPort, SyncPort, ZeloDataSource } from '@/shared/data/ports';
import { ZeloServicesProvider } from '@/shared/data/ZeloProvider';
import { SessionProvider } from '@/shared/data/session';
import { ToastProvider } from '@/shared/ui/Toast';

export const testProfile: Profile = {
  userId: '00000000-0000-4000-8000-000000000001',
  displayName: 'Ana',
  timezone: 'America/Sao_Paulo',
  visibleModules: ['body', 'bloodPressure', 'routine'],
  remindersEnabled: true,
  version: 1,
  updatedAt: '2026-10-17T10:00:00.000Z',
};

export function fakeData(overrides: Partial<ZeloDataSource> = {}): ZeloDataSource {
  const notImpl = () => vi.fn(() => Promise.reject(new Error('not implemented')));
  const base: Record<string, unknown> = {
    subscribe: vi.fn(() => () => {}),
  };
  return new Proxy({ ...base, ...overrides } as ZeloDataSource, {
    get(target, prop: string) {
      if (!(prop in target)) (target as unknown as Record<string, unknown>)[prop] = notImpl();
      return (target as unknown as Record<string, unknown>)[prop];
    },
  });
}

export function fakeSync(): SyncPort {
  const status = { online: true, offlineEnabled: false, lastSyncedAt: null, pendingCount: 0, conflictCount: 0, errorCount: 0, syncing: false, needsReauth: false };
  return {
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
}

export function Harness({ data, children, auth }: { data: ZeloDataSource; children: ReactNode; auth?: AuthPort }) {
  const a = auth ?? ({} as AuthPort);
  return (
    <ZeloServicesProvider value={{ data, sync: fakeSync(), auth: a }}>
      <SessionProvider
        value={{
          session: { user: { userId: testProfile.userId, email: 'ana@example.com' }, expiresAt: '2026-12-01T00:00:00.000Z' },
          profile: testProfile,
          setProfile: () => {},
          refreshProfile: async () => {},
          expire: vi.fn(),
        }}
      >
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </ZeloServicesProvider>
  );
}
