import type { NotificationJob, PushPayload, ReminderState } from '../../../domain/notification-job.js';

export interface PushSubscription {
  id: string;
  userId: string;
  deviceId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface PushSubscriptionRepository {
  /** Upsert by endpoint (an endpoint belongs to one browser; re-subscribing re-assigns it). Returns the stored record. */
  upsertByEndpoint(sub: PushSubscription): Promise<PushSubscription>;
  /** Removes stale subscriptions of the same user+device with a different endpoint (endpoint rotation). */
  deleteOthersForDevice(userId: string, deviceId: string, keepId: string): Promise<void>;
  deleteOwn(userId: string, id: string): Promise<boolean>;
  deleteByDevice(userId: string, deviceId: string): Promise<number>;
  deleteById(id: string): Promise<void>;
  getById(id: string): Promise<PushSubscription | null>;
  listByUser(userId: string): Promise<PushSubscription[]>;
}

export interface NotificationJobRepository {
  /** insert-if-absent keyed by (occurrenceId, subscriptionId); returns true if created */
  planOnce(job: NotificationJob, now: Date): Promise<boolean>;
  /** Atomically leases the next due pending job (safe with many workers). */
  claimDue(now: Date, leaseUntil: Date, owner: string): Promise<NotificationJob | null>;
  /** Finishes a leased job; no-op if the lease was lost. */
  complete(id: string, owner: string, status: 'sent' | 'cancelled' | 'failed', now: Date, detail?: string): Promise<boolean>;
  /** Releases a leased job for retry at `dueAt`. */
  retry(id: string, owner: string, attempts: number, dueAt: Date, now: Date, detail?: string): Promise<boolean>;
}

export interface ReminderCandidate {
  occurrenceId: string;
  userId: string;
  scheduledAt: Date;
}

/** Read-only view of routine data needed for reminders. */
export interface ReminderSource {
  /** live, undecided occurrences with reminderEnabled on a non-archived item, scheduledAt in [from, to] */
  listUpcoming(from: Date, to: Date): Promise<ReminderCandidate[]>;
  getState(occurrenceId: string): Promise<ReminderState | null>;
}

export type SendOutcome = { outcome: 'sent' } | { outcome: 'gone' } | { outcome: 'error'; message: string };

export interface NotificationGateway {
  /** false when VAPID keys are not configured: nothing is sent and nothing is reported as sent */
  isEnabled(): boolean;
  publicKey(): string | null;
  send(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: PushPayload): Promise<SendOutcome>;
}
