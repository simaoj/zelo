import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support/app.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ config: { rateLimit: { enabled: true, authMax: 10, writeMax: 2, globalMax: 20 } } });
});
afterAll(async () => { await ctx?.close(); });

it('read traffic does not exhaust the write budget, while repeated writes remain limited', async () => {
  const client = ctx.client();
  await client.csrf();
  for (let i = 0; i < 5; i++) expect((await client.get('/health')).statusCode).toBe(200);
  // Invalid payloads still consume the write budget without changing any data.
  expect((await client.patch('/profile', {})).statusCode).not.toBe(429);
  expect((await client.patch('/profile', {})).statusCode).not.toBe(429);
  const limited = await client.patch('/profile', {});
  expect(limited.statusCode).toBe(429);
  expect((await client.get('/health')).statusCode).toBe(200);
});
