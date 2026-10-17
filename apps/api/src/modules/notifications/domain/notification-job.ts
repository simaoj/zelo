/** Pure rules for reminder jobs. */

export type JobStatus = 'pending' | 'sent' | 'cancelled' | 'failed';

export interface NotificationJob {
  id: string;
  userId: string;
  occurrenceId: string;
  subscriptionId: string;
  /** occurrence instant (for staleness) */
  scheduledAt: Date;
  /** next attempt time */
  dueAt: Date;
  status: JobStatus;
  attempts: number;
  leaseUntil: Date | null;
  leaseOwner: string | null;
}

export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 60_000;
/** reminders older than this are dropped (worker downtime must not cause a burst of stale pushes) */
export const STALE_AFTER_MS = 60 * 60_000;
/** planning window: occurrences in [now − PLAN_PAST, now + PLAN_AHEAD] */
export const PLAN_PAST_MS = 10 * 60_000;
export const PLAN_AHEAD_MS = 2 * 60 * 60_000;

/** 30s, 60s, 120s… after the n-th failed attempt (n ≥ 1). */
export function backoffMs(attempts: number): number {
  return 30_000 * 2 ** Math.max(0, attempts - 1);
}

/** Generic lock-screen payload: never exposes item names, doses or measurements (spec §9). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** Live view of everything that may invalidate a reminder, read right before sending. */
export interface ReminderState {
  userId: string;
  scheduledAt: Date;
  cancelled: boolean;
  /** a live intake (taken or not_taken) exists */
  decided: boolean;
  itemArchived: boolean;
  reminderEnabled: boolean;
}

export type Revalidation = { send: true } | { send: false; reason: string };

/** REVALIDATE before sending (mandatory, spec §9). */
export function revalidate(
  job: Pick<NotificationJob, 'userId' | 'scheduledAt'>,
  state: ReminderState | null,
  ctx: { profileRemindersEnabled: boolean; subscription: { userId: string } | null; now: Date },
): Revalidation {
  if (!state) return { send: false, reason: 'occurrence_missing' };
  if (state.userId !== job.userId) return { send: false, reason: 'owner_mismatch' };
  if (state.cancelled) return { send: false, reason: 'occurrence_cancelled' };
  if (state.decided) return { send: false, reason: 'decision_recorded' };
  if (state.itemArchived) return { send: false, reason: 'item_archived' };
  if (!state.reminderEnabled) return { send: false, reason: 'reminder_disabled' };
  if (!ctx.profileRemindersEnabled) return { send: false, reason: 'profile_reminders_off' };
  if (!ctx.subscription || ctx.subscription.userId !== job.userId) return { send: false, reason: 'subscription_missing' };
  if (ctx.now.getTime() - state.scheduledAt.getTime() > STALE_AFTER_MS) return { send: false, reason: 'stale' };
  return { send: true };
}
