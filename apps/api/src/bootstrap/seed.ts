/**
 * Optional demo seed with FICTITIOUS data only (spec §5.1).
 * Creates demo@zelo.local / zelo-demo-123 and a few weeks of made-up records,
 * going through the real HTTP use cases (validation, idempotency, change log).
 * Idempotent: does nothing if the demo user already exists.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

const DEMO_EMAIL = 'demo@zelo.local';
const DEMO_PASSWORD = 'zelo-demo-123';
const TZ = 'America/Sao_Paulo';

class InjectClient {
  private cookies: Record<string, string> = {};
  constructor(private readonly app: FastifyInstance) {}
  async send(method: InjectOptions['method'], url: string, payload?: unknown) {
    if (!this.cookies.zelo_csrf) {
      const r = await this.app.inject({ method: 'GET', url: '/api/v1/auth/csrf' });
      for (const c of r.cookies as { name: string; value: string }[]) this.cookies[c.name] = c.value;
    }
    const res = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      cookies: this.cookies,
      headers: { 'x-csrf-token': this.cookies.zelo_csrf! },
      ...(payload !== undefined ? { payload: payload as InjectOptions['payload'] } : {}),
    });
    for (const c of res.cookies as { name: string; value: string }[]) this.cookies[c.name] = c.value;
    if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode} ${res.body}`);
    return res;
  }
}

async function main() {
  const config = { ...loadConfig(), logLevel: 'silent', rateLimit: { ...loadConfig().rateLimit, enabled: false } };
  const container = await createContainer(config);
  await container.ensureIndexes();
  try {
    if (await container.db.collection('users').findOne({ emailNormalized: DEMO_EMAIL })) {
      console.log(`seed: ${DEMO_EMAIL} already exists — nothing to do`);
      return;
    }
    const app = await buildApp(container);
    await app.ready();
    const c = new InjectClient(app);
    await c.send('POST', '/auth/sign-up', { email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'Pessoa Demo', timezone: TZ });

    const day = 24 * 3600 * 1000;
    const now = Date.now();
    for (let i = 27; i >= 0; i -= 3) {
      const measuredAt = new Date(now - i * day - 2 * 3600 * 1000).toISOString();
      const kg = (84 - (27 - i) * 0.07 + (i % 2 ? 0.15 : 0)).toFixed(2);
      await c.send('POST', '/weights', { operationId: randomUUID(), id: randomUUID(), measuredAt, timezone: TZ, weightKg: kg, notes: null });
      const sys = 118 + (i % 5);
      await c.send('POST', '/blood-pressure', { operationId: randomUUID(), id: randomUUID(), measuredAt, timezone: TZ, systolic: sys, diastolic: 76 + (i % 4), pulseBpm: i % 2 ? null : 68 + (i % 6) });
    }
    for (const [i, waist] of [[21, '92.5'], [7, '91.8']] as const) {
      await c.send('POST', '/measurements', {
        operationId: randomUUID(),
        id: randomUUID(),
        measuredAt: new Date(now - i * day).toISOString(),
        timezone: TZ,
        notes: null,
        values: [
          { type: 'waist', side: 'unspecified', valueCm: waist },
          { type: 'arm', side: 'left', valueCm: '31.5' },
        ],
      });
    }
    await c.send('PUT', '/weight-goal', { operationId: randomUUID(), targetKg: '80' });
    try {
      await c.send('POST', '/routine-items', {
        operationId: randomUUID(),
        id: randomUUID(),
        name: 'Vitamina D (exemplo)',
        type: 'vitamin',
        dose: '1',
        unit: 'cápsula',
        instructions: null,
        schedule: { frequency: 'daily', weekdays: [], times: ['08:00'], timezone: TZ, startDate: new Date(now - 7 * day).toISOString().slice(0, 10), endDate: null, reminderEnabled: true },
      });
    } catch (err) {
      console.warn('seed: routine item skipped:', err instanceof Error ? err.message : err);
    }
    await app.close();
    console.log(`seed: created ${DEMO_EMAIL} / ${DEMO_PASSWORD} with fictitious data`);
  } finally {
    await container.close();
  }
}

main().catch((err) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
