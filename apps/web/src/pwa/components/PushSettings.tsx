'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { createFetchSyncApi, DeviceFlags, isOfflineSync } from '@/infrastructure/offline';
import { getDeviceId } from '../device';
import { detectPlatform, isStandalone } from '../install';
import { usePwa } from '../PwaProvider';

type Caps = { sw: boolean; push: boolean; notification: boolean; iosNeedsInstall: boolean };

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function swReady(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}

/** Web Push opt-in. Permission is requested ONLY after the explicit click. Best effort. */
export function PushSettings() {
  const { sync } = usePwa();
  const [caps, setCaps] = useState<Caps | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);

  const api = useMemo(() => (isOfflineSync(sync) ? sync.pushApi() : createFetchSyncApi()), [sync]);
  const flags = useMemo(() => (isOfflineSync(sync) ? sync.flags() : new DeviceFlags()), [sync]);

  const refresh = useCallback(async () => {
    const c: Caps = {
      sw: 'serviceWorker' in navigator,
      push: 'PushManager' in window,
      notification: 'Notification' in window,
      iosNeedsInstall: detectPlatform().startsWith('ios') && !isStandalone(),
    };
    setCaps(c);
    setPermission(c.notification ? Notification.permission : 'unsupported');
    if (c.sw && c.push) {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(!!sub && !!flags.pushSubscriptionId);
    }
  }, [flags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- capability detection on mount
    void refresh();
  }, [refresh]);

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!navigator.onLine) throw new Error('Conecte-se à internet para ativar as notificações.');
      const { vapidPublicKey } = await api.pushConfig();
      if (!vapidPublicKey) {
        setMsg({ tone: 'info', text: 'As notificações push não estão disponíveis neste servidor. Os lembretes dentro do app continuam funcionando.' });
        return;
      }
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setMsg({ tone: 'info', text: 'Permissão não concedida. Você pode mudar isso nas configurações do navegador; os lembretes no app continuam funcionando.' });
        return;
      }
      const reg = await swReady();
      if (!reg) throw new Error('O app precisa estar instalado/carregado em produção para receber notificações.');
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('Assinatura de notificação inválida.');
      const res = await api.pushSubscribe({ deviceId: getDeviceId(), endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
      flags.setPushSubscriptionId(res.id);
      setSubscribed(true);
      setMsg({ tone: 'ok', text: 'Notificações ativadas neste dispositivo.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Não foi possível ativar as notificações.' });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (!navigator.onLine) throw new Error('Conecte-se à internet para desativar as notificações.');
      const id = flags.pushSubscriptionId;
      if (id) await api.pushUnsubscribe(id);
      const reg = await navigator.serviceWorker.getRegistration();
      await (await reg?.pushManager.getSubscription())?.unsubscribe();
      flags.setPushSubscriptionId(null);
      setSubscribed(false);
      setMsg({ tone: 'ok', text: 'Notificações desativadas neste dispositivo.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : 'Não foi possível desativar.' });
    } finally {
      setBusy(false);
    }
  };

  if (!caps) return null;
  const supported = caps.sw && caps.push && caps.notification;

  return (
    <section aria-labelledby="push-settings" className="rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-card)] sm:p-5">
      <h2 id="push-settings" className="font-semibold text-ink">
        Notificações de lembrete
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Os lembretes dentro do app funcionam sem notificações. O push é um extra de melhor esforço: depende do navegador, do sistema e da
        conexão, e pode atrasar ou não chegar. A mensagem na tela bloqueada é sempre genérica, sem nome de medicamento ou dose.
      </p>
      {caps.iosNeedsInstall ? (
        <p className="mt-2 rounded-[var(--radius-field)] bg-wash-sun p-3 text-sm text-ink">
          No iPhone e iPad, as notificações só funcionam com o Zelo instalado na Tela de Início (iOS 16.4 ou superior).
        </p>
      ) : null}
      {!supported && !caps.iosNeedsInstall ? <p className="mt-2 text-sm text-ink-muted">Este navegador não oferece notificações push.</p> : null}
      {permission === 'denied' ? <p className="mt-2 text-sm text-ink-muted">As notificações estão bloqueadas nas configurações do navegador para este site.</p> : null}
      {supported ? (
        <div className="mt-3">
          {subscribed ? (
            <Button variant="secondary" pending={busy} onClick={() => void disable()}>
              Desativar notificações
            </Button>
          ) : (
            <Button variant="primary" pending={busy} disabled={permission === 'denied'} onClick={() => void enable()}>
              Ativar notificações
            </Button>
          )}
        </div>
      ) : null}
      {msg ? (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mt-2 text-sm ${msg.tone === 'error' ? 'font-medium text-danger' : msg.tone === 'ok' ? 'text-brand-teal-ink' : 'text-ink-muted'}`}>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
