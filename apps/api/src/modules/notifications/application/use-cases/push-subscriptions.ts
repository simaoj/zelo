import type { Clock, IdGenerator } from '../../../../shared/application/ports.js';
import { NotFoundError, ValidationError } from '../../../../shared/domain/errors.js';
import type { PushSubscriptionRepository } from '../ports/out/index.js';

export interface RegisterPushSubscriptionInput {
  deviceId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export class RegisterPushSubscription {
  constructor(private readonly d: { subs: PushSubscriptionRepository; ids: IdGenerator; clock: Clock }) {}

  async execute(userId: string, input: RegisterPushSubscriptionInput): Promise<{ id: string; deviceId: string; createdAt: string }> {
    let url: URL;
    try {
      url = new URL(input.endpoint);
    } catch {
      throw new ValidationError('Endpoint inválido', { endpoint: ['Endpoint inválido'] });
    }
    if (url.protocol !== 'https:') throw new ValidationError('Endpoint inválido', { endpoint: ['O endpoint deve usar HTTPS'] });
    const now = this.d.clock.now();
    const stored = await this.d.subs.upsertByEndpoint({
      id: this.d.ids.next(),
      userId,
      deviceId: input.deviceId,
      endpoint: input.endpoint,
      keys: input.keys,
      createdAt: now,
      updatedAt: now,
    });
    await this.d.subs.deleteOthersForDevice(userId, input.deviceId, stored.id);
    return { id: stored.id, deviceId: stored.deviceId, createdAt: stored.createdAt.toISOString() };
  }
}

export class DeletePushSubscription {
  constructor(private readonly d: { subs: PushSubscriptionRepository }) {}

  /** Own subscriptions only; another user's id is indistinguishable from a missing one. */
  async execute(userId: string, id: string): Promise<void> {
    if (!(await this.d.subs.deleteOwn(userId, id))) throw new NotFoundError('Inscrição');
  }
}

/** Implements PushSubscriptionRevoker (logout / account deletion). Pending jobs die on revalidation. */
export class RevokeDeviceSubscriptions {
  constructor(private readonly d: { subs: PushSubscriptionRepository }) {}

  async execute(userId: string, deviceId: string): Promise<void> {
    await this.d.subs.deleteByDevice(userId, deviceId);
  }
}
