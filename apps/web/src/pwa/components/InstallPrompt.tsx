'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Share, X } from 'lucide-react';
import { detectPlatform, getInstallEvent, isStandalone, promptInstall, subscribeInstall, wasInstalled, type InstallPlatform } from '../install';

const DISMISS_KEY = 'zelo-install-dismissed';

/**
 * "Instalar Zelo" only when the browser fired `beforeinstallprompt`; otherwise short platform
 * instructions. Hidden when already running installed (standalone). The app stays fully usable
 * in the browser.
 */
export function InstallPrompt() {
  const event = useSyncExternalStore(subscribeInstall, getInstallEvent, () => null);
  const installed = useSyncExternalStore(subscribeInstall, wasInstalled, () => false);
  const [env, setEnv] = useState<{ standalone: boolean; platform: InstallPlatform; dismissed: boolean } | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only capability detection
    setEnv({ standalone: isStandalone(), platform: detectPlatform(), dismissed });
  }, []);

  if (!env || env.standalone || installed || env.dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setEnv({ ...env, dismissed: true });
  };

  let body: React.ReactNode;
  if (event) {
    body = (
      <>
        <p className="text-sm text-ink-muted">Abra o Zelo direto da tela inicial, mesmo com conexão instável.</p>
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[14px] bg-brand-orange px-4 text-sm font-semibold text-ink"
        >
          <Download aria-hidden className="size-4" />
          Instalar Zelo
        </button>
      </>
    );
  } else if (env.platform === 'ios-safari') {
    body = (
      <p className="text-sm text-ink-muted">
        No Safari, toque em <Share aria-label="Compartilhar" className="inline size-4 align-text-bottom" /> <strong>Compartilhar</strong> e depois em{' '}
        <strong>Adicionar à Tela de Início</strong>.
      </p>
    );
  } else if (env.platform === 'ios-other') {
    body = <p className="text-sm text-ink-muted">Para instalar no iPhone ou iPad, abra o Zelo no Safari e use Compartilhar → Adicionar à Tela de Início.</p>;
  } else if (env.platform === 'android') {
    body = <p className="text-sm text-ink-muted">No menu do navegador (⋮), escolha <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.</p>;
  } else {
    body = <p className="text-sm text-ink-muted">Se o seu navegador permitir, use o ícone de instalação na barra de endereço ou o menu para instalar o Zelo.</p>;
  }

  return (
    <section aria-labelledby="install-zelo" className="relative rounded-[var(--radius-card)] bg-wash-sun p-4 pr-12 text-ink shadow-[var(--shadow-card)]">
      <h2 id="install-zelo" className="font-semibold">
        Instale o Zelo
      </h2>
      {body}
      <button type="button" onClick={dismiss} aria-label="Dispensar sugestão de instalação" className="absolute right-1 top-1 inline-flex size-11 items-center justify-center rounded-full hover:bg-black/5">
        <X aria-hidden className="size-4" />
      </button>
    </section>
  );
}
