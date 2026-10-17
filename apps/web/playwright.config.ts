// E2E against the Docker stack (`docker compose up -d --build` → http://localhost:3000).
// Run: pnpm --filter @zelo/web test:e2e   (override with E2E_BASE_URL)
// The PWA/offline spec has its own config: e2e/playwright.pwa.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['offline.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
