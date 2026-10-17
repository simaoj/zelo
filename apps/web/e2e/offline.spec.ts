/**
 * PWA E2E (production build only — the service worker is not registered in `next dev`).
 * Covers spec §11: manifest + SW, offline shell after enabling offline, offline weight creation
 * that survives a reload and syncs exactly once after reconnecting.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = '/api/v1';

async function csrf(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/auth/csrf`);
  expect(res.ok()).toBeTruthy();
  const state = await request.storageState();
  const cookie = state.cookies.find((c) => c.name === 'zelo_csrf')?.value;
  const body = (await res.json().catch(() => ({}))) as { csrfToken?: string };
  return cookie ?? body.csrfToken ?? '';
}

async function signUp(request: APIRequestContext) {
  const email = `pwa-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const token = await csrf(request);
  const res = await request.post(`${API}/auth/sign-up`, {
    headers: { 'x-csrf-token': token },
    data: { email, password: 'senha-segura-123', displayName: 'Teste PWA', timezone: 'America/Sao_Paulo' },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return { email, token };
}

async function listWeights(request: APIRequestContext) {
  const res = await request.get(`${API}/weights?limit=200`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { items: Array<{ id: string; weightKg: string }> }).items;
}

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
}

test('manifest is installable and served from the production build', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m).toMatchObject({ id: '/', name: 'Zelo', short_name: 'Zelo', lang: 'pt-BR', start_url: '/hoje', scope: '/', display: 'standalone', background_color: '#FFFCF8' });
  expect(m.theme_color).toBeTruthy();
  const sizes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBeTruthy();
  expect((await request.get('/icons/apple-touch-icon.png')).ok()).toBeTruthy();
});

test('service worker is served, not cached by HTTP, and never caches the API', async ({ page, request }) => {
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBeTruthy();
  expect(sw.headers()['content-type']).toContain('javascript');
  expect(sw.headers()['cache-control']).toContain('no-cache');
  expect(await sw.text()).not.toContain('"url":"/api/');

  await signUp(page.request);
  await page.goto('/hoje');
  await waitForServiceWorkerControl(page);
  await page.waitForLoadState('networkidle');
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((u) => u.startsWith('/api/'))).toEqual([]);
});

test('offline: enable, open without network, register weight, reopen, reconnect → synced once', async ({ page, context }) => {
  const request = page.request;
  const { token } = await signUp(request);
  // pre-existing data that must be available offline
  const seedId = crypto.randomUUID();
  const seed = await request.post(`${API}/weights`, {
    headers: { 'x-csrf-token': token },
    data: { operationId: crypto.randomUUID(), id: seedId, measuredAt: new Date(Date.now() - 86_400_000).toISOString(), timezone: 'America/Sao_Paulo', weightKg: '83.1' },
  });
  expect(seed.status(), await seed.text()).toBeLessThan(300);

  await page.goto('/configuracoes');
  await waitForServiceWorkerControl(page);

  // 1. opt in to offline on this device
  const toggle = page.getByRole('switch', { name: /usar offline neste dispositivo/i });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByText(/seus dados foram baixados/i)).toBeVisible({ timeout: 20_000 });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // 2. no network: the shell and the downloaded data still open
  await context.setOffline(true);
  await page.goto('/corpo');
  await expect(page.getByText(/83,1/).first()).toBeVisible({ timeout: 20_000 });

  // 3. register a weight offline
  await page.getByRole('button', { name: /^registrar$/i }).first().click();
  await page.getByRole('button', { name: /^peso/i }).first().click();
  await page.getByLabel(/peso \(kg\)/i).fill('82,35');
  await page.getByRole('button', { name: /salvar registro/i }).click();
  await expect(page.getByRole('button', { name: /1 pendente/i })).toBeVisible({ timeout: 15_000 });

  // 4. reopen while still offline: the queued record survives
  await page.reload();
  await expect(page.getByRole('button', { name: /1 pendente/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/82,35/).first()).toBeVisible();

  // 5. reconnect → sync → exactly one new server record
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect
    .poll(async () => (await listWeights(request)).filter((w) => w.weightKg === '82.35').length, { timeout: 30_000 })
    .toBe(1);
  await expect(page.getByRole('button', { name: /sincronizado/i })).toBeVisible({ timeout: 20_000 });
  // a further sync must not duplicate
  await page.reload();
  await page.waitForLoadState('networkidle');
  expect((await listWeights(request)).filter((w) => w.weightKg === '82.35')).toHaveLength(1);
  expect(await listWeights(request)).toHaveLength(2);
});
