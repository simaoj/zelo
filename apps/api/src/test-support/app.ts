import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../bootstrap/app.js';
import { testConfig, type AppConfig } from '../bootstrap/config.js';
import { createContainer, type Container } from '../bootstrap/container.js';
import { Argon2PasswordHasher, MemoryMailer } from '../modules/identity/index.js';
import type { Clock } from '../shared/application/ports.js';
import { startMongo } from './mongo.js';

export interface TestContext {
  app: FastifyInstance;
  container: Container;
  mailer: MemoryMailer;
  /** new isolated client (own cookie jar) */
  client(): TestClient;
  close(): Promise<void>;
}

/**
 * Boots an in-memory replica set + the real composition root + Fastify (no network).
 * Usage (per test file): `let ctx: TestContext; beforeAll(async () => { ctx = await createTestContext(); }); afterAll(() => ctx.close());`
 */
export async function createTestContext(opts: { clock?: Clock; config?: Partial<AppConfig> } = {}): Promise<TestContext> {
  const mongo = await startMongo();
  const mailer = new MemoryMailer();
  const container = await createContainer(testConfig(opts.config), {
    client: mongo.client,
    dbName: mongo.dbName,
    mailer,
    hasher: new Argon2PasswordHasher({ memoryCost: 1024, timeCost: 1 }),
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  await container.ensureIndexes();
  const app = await buildApp(container);
  await app.ready();
  return {
    app,
    container,
    mailer,
    client: () => new TestClient(app),
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

/** Minimal browser-like client: cookie jar + automatic CSRF header on mutations. */
export class TestClient {
  readonly cookies = new Map<string, string>();
  userId: string | null = null;
  constructor(private readonly app: FastifyInstance) {}

  private store(res: LightMyRequestResponse) {
    for (const c of res.cookies as { name: string; value: string; maxAge?: number; expires?: Date }[]) {
      const expired = c.value === '' || (c.expires && c.expires.getTime() < Date.now()) || c.maxAge === 0;
      if (expired) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }

  async csrf(): Promise<string> {
    if (!this.cookies.get('zelo_csrf')) {
      const res = await this.app.inject({ method: 'GET', url: '/api/v1/auth/csrf', cookies: Object.fromEntries(this.cookies) });
      this.store(res);
    }
    return this.cookies.get('zelo_csrf')!;
  }

  async request(method: InjectOptions['method'], url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const h: Record<string, string> = { ...headers };
    if (method !== 'GET' && method !== 'HEAD') h['x-csrf-token'] = await this.csrf();
    const res = await this.app.inject({
      method,
      url: url.startsWith('/api/') ? url : `/api/v1${url}`,
      headers: h,
      cookies: Object.fromEntries(this.cookies),
      ...(body !== undefined ? { payload: body as InjectOptions['payload'] } : {}),
    });
    this.store(res);
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.request('POST', url, body ?? {}, headers);
  patch = (url: string, body: unknown) => this.request('PATCH', url, body);
  put = (url: string, body: unknown) => this.request('PUT', url, body);
  del = (url: string, body?: unknown) => this.request('DELETE', url, body);

  async signUp(email = `u-${randomUUID()}@zelo.test`, password = 'senha-segura-123'): Promise<{ userId: string; email: string }> {
    const res = await this.post('/auth/sign-up', { email, password, displayName: 'Pessoa Teste', timezone: 'America/Sao_Paulo' });
    if (res.statusCode !== 201) throw new Error(`sign-up failed ${res.statusCode} ${res.body}`);
    const json = res.json() as { user: { userId: string; email: string } };
    this.userId = json.user.userId;
    return json.user;
  }
}

export const op = () => ({ operationId: randomUUID() });
export const uuid = () => randomUUID();
