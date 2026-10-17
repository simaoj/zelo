// PWA/offline E2E against the Docker production build (docker compose up --build → http://localhost:3000).
// Run: pnpm --filter @zelo/web exec playwright test -c e2e/playwright.pwa.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['offline.spec.ts'],
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    serviceWorkers: 'allow',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
});
