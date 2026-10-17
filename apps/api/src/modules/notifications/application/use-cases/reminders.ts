import { GENERIC_PUSH_BODY, GENERIC_PUSH_TITLE } from '@zelo/contracts';
import type { Clock, IdGenerator } from '../../../../shared/application/ports.js';
import {
  backoffMs,
  LEASE_MS,
  MAX_ATTEMPTS,
  PLAN_AHEAD_MS,
  PLAN_PAST_MS,
  revalidate,
  type PushPayload,
} from '../../domain/notification-job.js';
import type { NotificationGateway, NotificationJobRepository, PushSubscriptionRepository, ReminderSource } from '../ports/out/index.js';

export interface RemindersDeps {
  jobs: NotificationJobRepository;
  subs: PushSubscriptionRepository;
  source: ReminderSource;
  gateway: NotificationGateway;
  remindersEnabled: (userId: string) => Promise<boolean>;
  clock: Clock;
  ids: IdGenerator;
}

/** Spec §9: generic text only; clicking opens the routine screen (never auto-confirms). */
export const GENERIC_PAYLOAD: PushPayload = { title: GENERIC_PUSH_TITLE, body: GENERIC_PUSH_BODY, url: '/rotina' };

/**
 * PlanReminders — one job per (occurrence, subscription) for upcoming, undecided occurrences with
 * reminders on, for users whose profile has reminders enabled. Idempotent (unique key).
 */
export class PlanReminders {
  constructor(private readonly d: RemindersDeps) {}

  async execute(): Promise<number> {
    if (!this.d.gateway.isEnabled()) return 0;
    const now = this.d.clock.now();
    const candidates = await this.d.source.listUpcoming(new Date(now.getTime() - PLAN_PAST_MS), new Date(now.getTime() + PLAN_AHEAD_MS));
    const byUser = new Map<string, typeof candidates>();
    for (const c of candidates) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
    let planned = 0;
    for (const [userId, occs] of byUser) {
      if (!(await this.d.remindersEnabled(userId))) continue;
      const subs = await this.d.subs.listByUser(userId);
      for (const o of occs) {
        for (const s of subs) {
          const created = await this.d.jobs.planOnce(
            {
              id: this.d.ids.next(),
              userId,
              occurrenceId: o.occurrenceId,
              subscriptionId: s.id,
              scheduledAt: o.scheduledAt,
              dueAt: o.scheduledAt,
              status: 'pending',
              attempts: 0,
              leaseUntil: null,
              leaseOwner: null,
            },
            now,
          );
          if (created) planned += 1;
        }
      }
    }
    return planned;
  }
}

export interface DispatchResult {
  sent: number;
  cancelled: number;
  failed: number;
  retried: number;
}

/**
 * DispatchDueReminders — claims due jobs with a lease (findOneAndUpdate; safe for many workers),
 * REVALIDATES, sends the generic payload. 404/410 → subscription removed. Max 3 attempts with backoff.
 */
export class DispatchDueReminders {
  constructor(
    private readonly d: RemindersDeps,
    private readonly owner: string,
  ) {}

  async execute(maxJobs = 200): Promise<DispatchResult> {
    const r: DispatchResult = { sent: 0, cancelled: 0, failed: 0, retried: 0 };
    if (!this.d.gateway.isEnabled()) return r;
    for (let i = 0; i < maxJobs; i++) {
      const now = this.d.clock.now();
      const job = await this.d.jobs.claimDue(now, new Date(now.getTime() + LEASE_MS), this.owner);
      if (!job) break;

      const [state, sub, remindersOn] = await Promise.all([
        this.d.source.getState(job.occurrenceId),
        this.d.subs.getById(job.subscriptionId),
        this.d.remindersEnabled(job.userId),
      ]);
      const check = revalidate(job, state, { profileRemindersEnabled: remindersOn, subscription: sub, now });
      if (!check.send || !sub) {
        await this.d.jobs.complete(job.id, this.owner, 'cancelled', now, check.send ? 'subscription_missing' : check.reason);
        r.cancelled += 1;
        continue;
      }

      const res = await this.d.gateway.send({ endpoint: sub.endpoint, keys: sub.keys }, GENERIC_PAYLOAD);
      const done = this.d.clock.now();
      if (res.outcome === 'sent') {
        await this.d.jobs.complete(job.id, this.owner, 'sent', done);
        r.sent += 1;
      } else if (res.outcome === 'gone') {
        await this.d.subs.deleteById(sub.id);
        await this.d.jobs.complete(job.id, this.owner, 'cancelled', done, 'subscription_gone');
        r.cancelled += 1;
      } else {
        const attempts = job.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await this.d.jobs.complete(job.id, this.owner, 'failed', done, res.message);
          r.failed += 1;
        } else {
          await this.d.jobs.retry(job.id, this.owner, attempts, new Date(done.getTime() + backoffMs(attempts)), done, res.message);
          r.retried += 1;
        }
      }
    }
    return r;
  }
}
