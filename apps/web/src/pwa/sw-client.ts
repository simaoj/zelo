/**
 * Service worker registration + update detection (client side).
 * Registered ONLY in production builds, in a secure context (HTTPS) or on localhost.
 * Updates are applied ONLY after a user action (UpdateBanner) and never while editing/syncing.
 */
type Listener = () => void;

const state: { waiting: ServiceWorker | null; registration: ServiceWorkerRegistration | null } = { waiting: null, registration: null };
const listeners = new Set<Listener>();
let registering: Promise<ServiceWorkerRegistration | null> | null = null;
let reloading = false;

const emit = () => listeners.forEach((l) => l());

export function subscribeSwUpdate(l: Listener) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
export const getWaitingWorker = () => state.waiting;

export function supportsServiceWorker() {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function isSecureOrigin() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return window.isSecureContext || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

function setWaiting(w: ServiceWorker | null) {
  state.waiting = w;
  emit();
}

function track(worker: ServiceWorker | null) {
  if (!worker) return;
  const check = () => {
    // "installed" + an existing controller = a NEW version waiting (first install has no controller)
    if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
  };
  check();
  worker.addEventListener('statechange', check);
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registering) return registering;
  registering = (async () => {
    if (!supportsServiceWorker() || process.env.NODE_ENV !== 'production' || !isSecureOrigin()) return null;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      state.registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      const check = () => void reg.update().catch(() => undefined);
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      return reg;
    } catch {
      return null;
    }
  })();
  return registering;
}

/** Activates the waiting worker and reloads once it takes control. Caller checks the guards. */
export function applyUpdate(): boolean {
  const w = state.waiting;
  if (!w || !supportsServiceWorker()) return false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  w.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
