'use client';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Profile, SessionResponse } from '@zelo/contracts';
import { ConflictCenter, PwaProvider, UpdateBanner } from '@/pwa';
import { useZelo } from '@/shared/data/ZeloProvider';
import { SessionProvider, type SessionContextValue } from '@/shared/data/session';
import { DataError, OfflineError } from '@/shared/data/ports';
import { Button } from '@/shared/ui/Button';
import { Splash } from './Splash';
import { AppShell } from './AppShell';
import { RegisterProvider } from './RegisterDialog';

type GuardState =
  | { status: 'loading' }
  | { status: 'ready'; session: SessionResponse; profile: Profile }
  | { status: 'offline' }
  | { status: 'error' };

/** Client auth guard (AuthPort.getSession) + authenticated providers and shell. */
export function AuthenticatedApp({ children }: { children: ReactNode }) {
  const { auth, data, sync } = useZelo();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<GuardState>({ status: 'loading' });
  const expire = useCallback(() => {
    router.replace('/entrar?sessao=expirada');
  }, [router]);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const session = await auth.getSession();
      if (!session) {
        router.replace(`/entrar?voltar=${encodeURIComponent(pathname)}`);
        return;
      }
      const profile = await data.getProfile();
      setState({ status: 'ready', session, profile });
    } catch (e) {
      if (e instanceof DataError && e.status === 401) return expire();
      setState({ status: e instanceof OfflineError ? 'offline' : 'error' });
    }
    // pathname intentionally excluded: guard runs once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, data, router, expire]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial session check
    void load();
  }, [load]);

  const ready = state.status === 'ready' ? state : null;
  const setProfile = useCallback((p: Profile) => setState((s) => (s.status === 'ready' ? { ...s, profile: p } : s)), []);
  const refreshProfile = useCallback(async () => {
    const p = await data.getProfile();
    setProfile(p);
  }, [data, setProfile]);

  const value = useMemo<SessionContextValue | null>(
    () => (ready ? { session: ready.session, profile: ready.profile, setProfile, refreshProfile, expire } : null),
    [ready, setProfile, refreshProfile, expire],
  );

  if (state.status === 'loading') return <Splash />;
  if (state.status === 'offline' || state.status === 'error') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="font-display text-2xl font-semibold">{state.status === 'offline' ? 'Você está offline' : 'Não foi possível abrir o Zelo'}</p>
        <p className="max-w-sm text-sm text-ink-muted">
          {state.status === 'offline'
            ? 'Conecte-se à internet para entrar. Se você ativou o uso offline neste dispositivo, seus dados aparecerão assim que a sessão for confirmada.'
            : 'O serviço não respondeu. Tente novamente em instantes.'}
        </p>
        <Button variant="primary" onClick={() => void load()}>
          Tentar novamente
        </Button>
      </div>
    );
  }
  if (!value) return <Splash />;

  return (
    <SessionProvider value={value}>
      <PwaProvider sync={sync} data={data} auth={auth}>
        <RegisterProvider>
          <AppShell>{children}</AppShell>
          <UpdateBanner />
          <ConflictCenter />
        </RegisterProvider>
      </PwaProvider>
    </SessionProvider>
  );
}
