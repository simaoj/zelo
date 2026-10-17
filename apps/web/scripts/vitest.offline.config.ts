// Standalone vitest config for the PWA/offline tests (used until/unless apps/web/vitest.config.ts
// provides the same alias). Run: pnpm --filter @zelo/web exec vitest run --config scripts/vitest.offline.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  root,
  resolve: { alias: { '@': path.join(root, 'src') } },
  test: {
    environment: 'jsdom',
    include: ['src/infrastructure/offline/**/*.test.ts', 'src/pwa/**/*.test.{ts,tsx}'],
  },
});
