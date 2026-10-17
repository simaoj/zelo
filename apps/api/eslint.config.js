import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    // hexagonal boundary (also enforced by src/__tests__/architecture.test.ts)
    files: ['src/modules/*/domain/**/*.ts', 'src/modules/*/application/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['fastify', 'fastify/*', '@fastify/*', 'fastify-type-provider-zod', 'mongodb', 'nodemailer', 'argon2', 'web-push'], message: 'Domain/application must not depend on frameworks or drivers.' },
            { group: ['**/adapters/**', '**/bootstrap/**', '**/shared/http/**'], message: 'Domain/application must not import adapters, HTTP or the composition root.' },
          ],
        },
      ],
    },
  },
);
