import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../test-support/app.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx?.close();
});

describe('identity', () => {
  it('health is public', async () => {
    const res = await ctx.client().get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', mongo: 'up' });
    expect(res.headers['x-correlation-id']).toBeTruthy();
  });

  it('rejects mutations without CSRF token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/sign-in', payload: { email: 'a@b.co', password: 'x' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CSRF_FAILED');
    expect(res.json().correlationId).toBeTruthy();
  });

  it('sign-up → session → sign-out → 401; sign-in again', async () => {
    const c = ctx.client();
    const user = await c.signUp('Pessoa@Example.com');
    const cookie = c.cookies.get('zelo_session');
    expect(cookie).toBeTruthy();
    const session = await c.get('/auth/session');
    expect(session.statusCode).toBe(200);
    expect(session.json().user.userId).toBe(user.userId);

    const profile = await c.get('/profile');
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ userId: user.userId, displayName: 'Pessoa Teste', timezone: 'America/Sao_Paulo', version: 0 });

    // session token is stored hashed
    const stored = await ctx.container.db.collection('sessions').findOne({ userId: user.userId });
    expect(stored?._id).not.toBe(cookie);

    expect((await c.post('/auth/sign-out')).statusCode).toBe(204);
    expect((await c.get('/profile')).statusCode).toBe(401);
    // old cookie no longer valid even if replayed
    const replay = await ctx.app.inject({ method: 'GET', url: '/api/v1/profile', cookies: { zelo_session: cookie! } });
    expect(replay.statusCode).toBe(401);

    const bad = await c.post('/auth/sign-in', { email: 'pessoa@example.com', password: 'errada-123' });
    expect(bad.statusCode).toBe(401);
    const ok = await c.post('/auth/sign-in', { email: 'PESSOA@example.com', password: 'senha-segura-123' });
    expect(ok.statusCode).toBe(200);
    expect((await c.get('/profile')).statusCode).toBe(200);
  });

  it('duplicate e-mail is rejected', async () => {
    const c = ctx.client();
    await c.signUp('dup@example.com');
    const res = await ctx.client().post('/auth/sign-up', { email: 'DUP@example.com', password: 'senha-segura-123', displayName: 'X', timezone: 'UTC' });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors.email).toBeDefined();
  });

  it('password reset: always 202, single-use token, revokes sessions', async () => {
    const c = ctx.client();
    await c.signUp('reset@example.com');
    const anon = ctx.client();
    expect((await anon.post('/auth/password-reset/request', { email: 'nobody@example.com' })).statusCode).toBe(202);
    expect(ctx.mailer.sent.find((m) => m.to === 'nobody@example.com')).toBeUndefined();
    expect((await anon.post('/auth/password-reset/request', { email: 'reset@example.com' })).statusCode).toBe(202);
    const mail = ctx.mailer.sent.find((m) => m.to === 'reset@example.com');
    expect(mail?.link).toMatch(/\/redefinir-senha\?token=/);
    const token = new URL(mail!.link).searchParams.get('token')!;

    expect((await anon.post('/auth/password-reset/confirm', { token, password: 'nova-senha-456' })).statusCode).toBe(204);
    expect((await anon.post('/auth/password-reset/confirm', { token, password: 'outra-senha-789' })).statusCode).toBe(400);
    expect((await c.get('/profile')).statusCode).toBe(401);
    expect((await anon.post('/auth/sign-in', { email: 'reset@example.com', password: 'nova-senha-456' })).statusCode).toBe(200);
  });

  it('openapi document is served', async () => {
    const res = await ctx.client().get('/openapi.json');
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.paths['/api/v1/weights']).toBeDefined();
    expect(doc.paths['/api/v1/sync/operations']).toBeDefined();
  });
});
