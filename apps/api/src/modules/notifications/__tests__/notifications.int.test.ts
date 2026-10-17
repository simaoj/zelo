import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Occurrence } from '@zelo/contracts';
import { createTestContext, op, uuid, type TestClient, type TestContext } from '../../../test-support/app.js';
import type { NotificationJob, PushPayload } from '../domain/notification-job.js';
import type { NotificationGateway, SendOutcome } from '../application/ports/out/index.js';
import { DispatchDueReminders, PlanReminders, type RemindersDeps } from '../application/use-cases/reminders.js';
import { MongoNotificationJobRepository } from '../adapters/out/mongodb/mongo-notification-job-repository.js';
import { MongoPushSubscriptionRepository } from '../adapters/out/mongodb/mongo-push-subscription-repository.js';
import { MongoReminderSource } from '../adapters/out/mongodb/mongo-reminder-source.js';

let ctx: TestContext;
let a: TestClient;
let b: TestClient;
const TZ = 'America/Sao_Paulo';
const fmt = (d: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};

class RecordingGateway implements NotificationGateway {
  sent: { endpoint: string; payload: PushPayload }[] = [];
  outcome: SendOutcome = { outcome: 'sent' };
  isEnabled() {
    return true;
  }
  publicKey() {
    return 'test-key';
  }
  async send(sub: { endpoint: string }, payload: PushPayload) {
    this.sent.push({ endpoint: sub.endpoint, payload });
    return this.outcome;
  }
}

function remindersDeps(gateway: NotificationGateway, now: () => Date): RemindersDeps {
  const db = ctx.container.db;
  const profiles = db.collection('profiles');
  return {
    jobs: new MongoNotificationJobRepository(db),
    subs: new MongoPushSubscriptionRepository(db),
    source: new MongoReminderSource(db),
    gateway,
    remindersEnabled: async (userId) => (await profiles.findOne({ userId }))?.remindersEnabled === true,
    clock: { now },
    ids: { next: () => uuid() },
  };
}

let occurrence: Occurrence;
let dueAt: Date;

beforeAll(async () => {
  ctx = await createTestContext();
  a = ctx.client();
  b = ctx.client();
  await a.signUp();
  await b.signUp();
  const profile = (await a.get('/profile')).json();
  const pr = await a.patch('/profile', { ...op(), expectedVersion: profile.version, remindersEnabled: true });
  expect(pr.statusCode, pr.body).toBe(200);

  const at = new Date(Date.now() + 5 * 60_000);
  const local = fmt(at);
  const res = await a.post('/routine-items', {
    ...op(),
    id: uuid(),
    name: 'Remédio secreto',
    type: 'medication',
    dose: '1',
    unit: 'comprimido',
    schedule: { frequency: 'daily', weekdays: [], times: [local.time], timezone: TZ, startDate: fmt(new Date()).date, endDate: null, reminderEnabled: true },
  });
  expect(res.statusCode, res.body).toBe(201);
  const occ = await a.get(`/occurrences?date=${local.date}`);
  occurrence = (occ.json().items as Occurrence[]).find((o) => o.localTime === local.time)!;
  dueAt = new Date(occurrence.scheduledAt);
}, 120_000);

afterAll(async () => ctx?.close());

describe('push subscriptions HTTP', () => {
  it('upserts by endpoint, isolates users, config endpoint works', async () => {
    const cfg = await a.get('/push-subscriptions/config');
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json()).toHaveProperty('vapidPublicKey');

    const deviceId = uuid();
    const body = { deviceId, endpoint: 'https://push.example.com/a1', keys: { p256dh: 'p', auth: 'x' } };
    const r1 = await a.post('/push-subscriptions', body);
    expect(r1.statusCode, r1.body).toBe(201);
    const r2 = await a.post('/push-subscriptions', body);
    expect(r2.json().id).toBe(r1.json().id);
    expect(await ctx.container.db.collection('pushSubscriptions').countDocuments({ endpoint: body.endpoint })).toBe(1);

    // B cannot delete A's subscription
    expect((await b.del(`/push-subscriptions/${r1.json().id}`)).statusCode).toBe(404);
    expect(await ctx.container.db.collection('pushSubscriptions').countDocuments({ _id: r1.json().id })).toBe(1);

    // a second endpoint for the same device replaces the first (rotation)
    const r3 = await a.post('/push-subscriptions', { ...body, endpoint: 'https://push.example.com/a2' });
    expect(r3.statusCode).toBe(201);
    expect(await ctx.container.db.collection('pushSubscriptions').countDocuments({ userId: a.userId })).toBe(1);

    // own delete
    expect((await a.del(`/push-subscriptions/${r3.json().id}`)).statusCode).toBe(204);
  });
});

describe('reminder jobs', () => {
  it('plans per subscription, sends the GENERIC payload once, revalidates after a decision', async () => {
    const devA1 = uuid();
    const devA2 = uuid();
    await a.post('/push-subscriptions', { deviceId: devA1, endpoint: 'https://push.example.com/d1', keys: { p256dh: 'p', auth: 'x' } });
    await a.post('/push-subscriptions', { deviceId: devA2, endpoint: 'https://push.example.com/d2', keys: { p256dh: 'p', auth: 'x' } });
    await b.post('/push-subscriptions', { deviceId: uuid(), endpoint: 'https://push.example.com/b1', keys: { p256dh: 'p', auth: 'x' } });

    const gw = new RecordingGateway();
    let now = new Date();
    const deps = remindersDeps(gw, () => now);
    expect(await new PlanReminders(deps).execute()).toBe(2); // two subscriptions of A; B has no occurrence
    expect(await new PlanReminders(deps).execute()).toBe(0); // idempotent

    // revoke device 2 (logout) → its planned job must be cancelled on revalidation
    const revoker = new MongoPushSubscriptionRepository(ctx.container.db);
    await revoker.deleteByDevice(a.userId!, devA2);

    now = new Date(dueAt.getTime() + 30_000);
    const res = await new DispatchDueReminders(deps, 'w1').execute();
    expect(res).toMatchObject({ sent: 1, cancelled: 1 }); // revoked device → cancelled on revalidation
    expect(gw.sent).toHaveLength(1);
    expect(gw.sent[0]!.payload).toEqual({ title: 'Zelo', body: 'Você tem um cuidado programado no Zelo', url: '/rotina' });
    expect(JSON.stringify(gw.sent[0]!.payload)).not.toContain('secreto');
  });

  it('skips after a decision is recorded (revalidation)', async () => {
    // reset jobs to pending to simulate a planned-but-not-sent reminder
    const jobs = ctx.container.db.collection('notificationJobs');
    await jobs.updateMany({}, { $set: { status: 'pending', leaseUntil: null, leaseOwner: null } });
    const occ = (await a.get(`/occurrences?date=${occurrence.localDate}`)).json().items.find((o: Occurrence) => o.id === occurrence.id);
    const put = await a.put(`/occurrences/${occurrence.id}/intake`, { ...op(), intakeId: uuid(), status: 'not_taken', actualTakenAt: null, ...(occ.intake ? { expectedVersion: occ.intake.version } : {}) });
    expect(put.statusCode, put.body).toBeLessThan(300);

    const gw = new RecordingGateway();
    const deps = remindersDeps(gw, () => new Date(dueAt.getTime() + 30_000));
    const res = await new DispatchDueReminders(deps, 'w1').execute();
    expect(res.sent).toBe(0);
    expect(gw.sent).toHaveLength(0);
    expect(await jobs.countDocuments({ status: 'cancelled', lastError: 'decision_recorded' })).toBeGreaterThan(0);
  });

  it('lease: two concurrent claimers never claim the same job', async () => {
    const repo = new MongoNotificationJobRepository(ctx.container.db);
    const now = new Date();
    const occIds = Array.from({ length: 40 }, () => uuid());
    for (const occurrenceId of occIds) {
      const job: NotificationJob = {
        id: uuid(), userId: 'lease-user', occurrenceId, subscriptionId: 'sub', scheduledAt: now, dueAt: new Date(now.getTime() - 1000),
        status: 'pending', attempts: 0, leaseUntil: null, leaseOwner: null,
      };
      await repo.planOnce(job, now);
    }
    const claimed: Record<string, string[]> = { w1: [], w2: [] };
    const worker = async (owner: string) => {
      for (;;) {
        const j = await repo.claimDue(now, new Date(now.getTime() + 60_000), owner);
        if (!j) return;
        if (j.userId === 'lease-user') claimed[owner]!.push(j.occurrenceId);
      }
    };
    await Promise.all([worker('w1'), worker('w2')]);
    const all = [...claimed.w1!, ...claimed.w2!];
    expect(all).toHaveLength(occIds.length);
    expect(new Set(all).size).toBe(occIds.length);
    // a leased job is not claimable again before the lease expires
    expect(await repo.claimDue(now, new Date(now.getTime() + 60_000), 'w3')).toBeNull();
  });
});
