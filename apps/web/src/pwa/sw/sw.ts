/// <reference lib="webworker" />
/**
 * Zelo service worker (bundled by `serwist build scripts/serwist.config.mjs` → public/sw.js).
 *
 * Rules (spec §9):
 *  - Precache ONLY the app shell (prerendered static HTML, which by construction has no user data)
 *    and versioned static assets (/_next/static, /public).
 *  - /api/* is network-only: authenticated / health data NEVER goes to Cache Storage.
 *  - Navigations: network first, never cached at runtime; offline → precached shell.
 *  - Updates wait for the user: the page posts {type:'SKIP_WAITING'} from the UpdateBanner.
 *  - No session tokens are stored here (the session is an HttpOnly cookie handled by the browser).
 */
import { NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const GENERIC_PUSH_TITLE = 'Zelo';
const GENERIC_PUSH_BODY = 'Você tem um cuidado programado no Zelo';
const SHELL_FALLBACKS = ['/hoje', '/'];
const SYNC_TAG = 'zelo-sync';

const OFFLINE_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zelo — offline</title>
<style>body{font-family:system-ui,sans-serif;background:#FFFCF8;color:#202020;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}button{min-height:44px;padding:0 20px;border-radius:999px;border:0;background:#FF8243;color:#202020;font-weight:600}</style></head>
<body><main><h1>Você está offline</h1><p>Conecte-se à internet para abrir o Zelo.</p><button onclick="location.reload()">Tentar novamente</button></main></body></html>`;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: [
    // Never touch the API with Cache Storage.
    { matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/api/'), handler: new NetworkOnly() },
    // Navigations not in the precache: network only (never cached); offline → precached shell.
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: async ({ request }) => {
        try {
          return await fetch(request);
        } catch {
          return shellResponse(new URL(request.url).pathname);
        }
      },
    },
  ],
});

async function shellResponse(pathname: string): Promise<Response> {
  for (const url of [pathname, ...SHELL_FALLBACKS]) {
    const res = await serwist.matchPrecache(url);
    if (res) return res;
  }
  return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

serwist.addEventListeners();

// ---------- remove caches that are not ours (after a safe activation) ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([serwist.precacheStrategy.cacheName]);
      for (const name of await caches.keys()) {
        if (!keep.has(name) && !name.startsWith('serwist-precache')) await caches.delete(name);
      }
    })(),
  );
});

// ---------- messages from the page ----------
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// ---------- optional Background Sync: only asks open clients to sync ----------
self.addEventListener('sync', (event: Event) => {
  const e = event as Event & { tag?: string; waitUntil(p: Promise<unknown>): void };
  if (e.tag !== SYNC_TAG) return;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) c.postMessage({ type: 'SYNC_REQUESTED' });
    }),
  );
});

// ---------- Web Push: generic text only, never exposes medication/dose/measure ----------
self.addEventListener('push', (event) => {
  let title = GENERIC_PUSH_TITLE;
  let body = GENERIC_PUSH_BODY;
  let url = '/rotina';
  try {
    const payload = event.data?.json() as { title?: unknown; body?: unknown; url?: unknown } | undefined;
    if (payload && typeof payload.title === 'string' && payload.title) title = payload.title;
    if (payload && typeof payload.body === 'string' && payload.body) body = payload.body;
    if (payload && typeof payload.url === 'string' && payload.url.startsWith('/')) url = payload.url;
  } catch {
    /* non-JSON payload → generic text */
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-maskable-192.png',
      lang: 'pt-BR',
      tag: 'zelo-reminder',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data as { url?: string } | null)?.url ?? '/rotina', self.location.origin);
  if (target.origin !== self.location.origin) target.href = new URL('/rotina', self.location.origin).href;
  // Opens/focuses the routine. NEVER records an intake automatically.
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          await w.focus();
          if ('navigate' in w) await (w as WindowClient).navigate(target.href).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
