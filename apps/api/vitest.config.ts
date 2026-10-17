import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts', 'node_modules/**', 'dist/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          exclude: ['node_modules/**', 'dist/**'],
          environment: 'node',
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // each file starts its own in-memory replica set; keep parallelism modest
          maxWorkers: 4,
        },
      },
    ],
  },
});
