// Smoke check of the production PWA without the API: SW registers, precaches the shell,
// and app routes open offline. Usage: node scripts/verify-sw.mjs [baseUrl]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:3000';
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'allow' });
const page = await context.newPage();
await page.goto(`${base}/entrar`);
const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
const cached = await page.evaluate(async () => {
  const out = [];
  for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(new URL(r.url).pathname);
  return out;
});
await context.setOffline(true);
const results = {};
for (const route of ['/hoje', '/corpo', '/entrar', '/rota-inexistente']) {
  const res = await page.goto(`${base}${route}`).catch((e) => ({ status: () => `ERR ${e.message.split('\n')[0]}` }));
  results[route] = `${res?.status?.()} ${(await page.title().catch(() => '')) || ''}`;
}
console.log(JSON.stringify({ scope, cachedCount: cached.length, apiCached: cached.filter((u) => u.startsWith('/api/')), shellCached: cached.filter((u) => !u.startsWith('/_next')), offline: results }, null, 2));
await browser.close();
