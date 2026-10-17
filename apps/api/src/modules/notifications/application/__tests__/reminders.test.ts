import { describe, expect, it } from 'vitest';
import { GENERIC_PUSH_BODY, GENERIC_PUSH_TITLE } from '@zelo/contracts';
import type { NotificationJob, PushPayload, ReminderState } from '../../domain/notification-job.js';
import { backoffMs, revalidate } from '../../domain/notification-job.js';
import type { NotificationGateway, NotificationJobRepository, PushSubscription, PushSubscriptionRepository, ReminderSource, SendOutcome } from '../ports/out/index.js';
import { DispatchDueReminders, PlanReminders, type RemindersDeps } from '../use-cases/reminders.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const state = (p: Partial<ReminderState> = {}): ReminderState => ({
  userId: 'u', scheduledAt: NOW, cancelled: false, decided: false, itemArchived: false, reminderEnabled: true, ...p,
});

describe('revalidate', () => {
  const job = { userId: 'u', scheduledAt: NOW };
  const ok = { profileRemindersEnabled: true, subscription: { userId: 'u' }, now: NOW };
  it('sends only when everything is still valid', () => {
    expect(revalidate(job, state(), ok)).toEqual({ send: true });
    expect(revalidate(job, null, ok)).toMatchObject({ send: false });
    expect(revalidate(job, state({ cancelled: true }), ok)).toMatchObject({ reason: 'occurrence_cancelled' });
    expect(revalidate(job, state({ decided: true }), ok)).toMatchObject({ reason: 'decision_recorded' });
    expect(revalidate(job, state({ itemArchived: true }), ok)).toMatchObject({ reason: 'item_archived' });
    expect(revalidate(job, state({ reminderEnabled: false }), ok)).toMatchObject({ reason: 'reminder_disabled' });
    expect(revalidate(job, state(), { ...ok, profileRemindersEnabled: false })).toMatchObject({ reason: 'profile_reminders_off' });
    expect(revalidate(job, state(), { ...ok, subscription: null })).toMatchObject({ reason: 'subscription_missing' });
    expect(revalidate(job, state(), { ...ok, subscription: { userId: 'other' } })).toMatchObject({ reason: 'subscription_missing' });
    expect(revalidate(job, state(), { ...ok, now: new Date(NOW.getTime() + 2 * 3600_000) })).toMatchObject({ reason: 'stale' });
  });
  it('backoff grows', () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
  });
});

class MemJobs implements NotificationJobRepository {
  rows: (NotificationJob & { lastError?: string | undefined })[] = [];
  async planOnce(job: NotificationJob) {
    if (this.rows.some((r) => r.occurrenceId === job.occurrenceId && r.subscriptionId === job.subscriptionId)) return false;
    this.rows.push({ ...job });
    return true;
  }
  async claimDue(now: Date, leaseUntil: Date, owner: string) {
    const j = this.rows
      .filter((r) => r.status === 'pending' && r.dueAt <= now && (!r.leaseUntil || r.leaseUntil <= now))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
    if (!j) return null;
    Object.assign(j, { leaseUntil, leaseOwner: owner });
    return { ...j };
  }
  async complete(id: string, owner: string, status: 'sent' | 'cancelled' | 'failed', _now: Date, detail?: string) {
    const j = this.rows.find((r) => r.id === id && r.leaseOwner === owner && r.status === 'pending');
    if (!j) return false;
    Object.assign(j, { status, leaseOwner: null, leaseUntil: null, lastError: detail });
    return true;
  }
  async retry(id: string, owner: string, attempts: number, dueAt: Date) {
    const j = this.rows.find((r) => r.id === id && r.leaseOwner === owner);
    if (!j) return false;
    Object.assign(j, { attempts, dueAt, leaseOwner: null, leaseUntil: null });
    return true;
  }
}

function setup(outcomes: SendOutcome[] = [{ outcome: 'sent' }]) {
  let now = new Date(NOW);
  let n = 0;
  const sub: PushSubscription = { id: 's1', userId: 'u', deviceId: 'd', endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' }, createdAt: NOW, updatedAt: NOW };
  const subs = new Map([[sub.id, sub]]);
  const st = state({ scheduledAt: new Date(NOW.getTime() + 60_000) });
  const sent: PushPayload[] = [];
  const subsRepo = {
    listByUser: async (u: string) => [...subs.values()].filter((s) => s.userId === u),
    getById: async (id: string) => subs.get(id) ?? null,
    deleteById: async (id: string) => void subs.delete(id),
  } as unknown as PushSubscriptionRepository;
  const source: ReminderSource = {
    listUpcoming: async () => (st.cancelled || st.decided ? [] : [{ occurrenceId: 'o1', userId: 'u', scheduledAt: st.scheduledAt }]),
    getState: async () => ({ ...st }),
  };
  const gateway: NotificationGateway = {
    isEnabled: () => true,
    publicKey: () => 'pk',
    send: async (_s, payload) => {
      sent.push(payload);
      return outcomes[Math.min(sent.length - 1, outcomes.length - 1)]!;
    },
  };
  const jobs = new MemJobs();
  const deps: RemindersDeps = {
    jobs, subs: subsRepo, source, gateway,
    remindersEnabled: async () => true,
    clock: { now: () => new Date(now) },
    ids: { next: () => `job-${++n}` },
  };
  return { deps, jobs, subs, st, sent, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('PlanReminders + DispatchDueReminders', () => {
  it('plans once per (occurrence, subscription) and sends the GENERIC payload when due', async () => {
    const t = setup();
    expect(await new PlanReminders(t.deps).execute()).toBe(1);
    expect(await new PlanReminders(t.deps).execute()).toBe(0);
    const dispatch = new DispatchDueReminders(t.deps, 'w1');
    expect((await dispatch.execute()).sent).toBe(0); // not due yet
    t.advance(60_000);
    expect((await dispatch.execute()).sent).toBe(1);
    expect(t.sent).toEqual([{ title: GENERIC_PUSH_TITLE, body: GENERIC_PUSH_BODY, url: '/rotina' }]);
    expect(t.jobs.rows[0]!.status).toBe('sent');
  });

  it('skips (cancels) after a decision was recorded', async () => {
    const t = setup();
    await new PlanReminders(t.deps).execute();
    t.st.decided = true;
    t.advance(60_000);
    const r = await new DispatchDueReminders(t.deps, 'w1').execute();
    expect(r).toMatchObject({ sent: 0, cancelled: 1 });
    expect(t.sent).toHaveLength(0);
    expect(t.jobs.rows[0]!.status).toBe('cancelled');
  });

  it('410 removes the subscription', async () => {
    const t = setup([{ outcome: 'gone' }]);
    await new PlanReminders(t.deps).execute();
    t.advance(60_000);
    await new DispatchDueReminders(t.deps, 'w1').execute();
    expect(t.subs.size).toBe(0);
    expect(t.jobs.rows[0]!.status).toBe('cancelled');
  });

  it('retries with backoff, max 3 attempts → failed', async () => {
    const t = setup([{ outcome: 'error', message: 'boom' }]);
    await new PlanReminders(t.deps).execute();
    const dispatch = new DispatchDueReminders(t.deps, 'w1');
    t.advance(60_000);
    expect((await dispatch.execute()).retried).toBe(1);
    expect((await dispatch.execute()).retried).toBe(0); // backoff not elapsed
    t.advance(30_000);
    expect((await dispatch.execute()).retried).toBe(1);
    t.advance(60_000);
    expect((await dispatch.execute()).failed).toBe(1);
    expect(t.sent).toHaveLength(3);
    expect(t.jobs.rows[0]!.status).toBe('failed');
  });

  it('does nothing when the gateway is disabled (never fakes success)', async () => {
    const t = setup();
    t.deps.gateway.isEnabled = () => false;
    expect(await new PlanReminders(t.deps).execute()).toBe(0);
    expect(await new DispatchDueReminders(t.deps, 'w').execute()).toEqual({ sent: 0, cancelled: 0, failed: 0, retried: 0 });
  });
});
