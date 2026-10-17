import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { PushConfigResponse, PushSubscriptionRequest, PushSubscriptionResponse } from '@zelo/contracts';
import { errorResponses, IdParams, NoContent, requireActor } from '../../../../../shared/http/index.js';
import type { NotificationGateway } from '../../../application/ports/out/index.js';
import type { DeletePushSubscription, RegisterPushSubscription } from '../../../application/use-cases/push-subscriptions.js';

export function pushRoutes(deps: {
  register: RegisterPushSubscription;
  remove: DeletePushSubscription;
  gateway: NotificationGateway;
}): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    const tags = ['push'];

    app.get(
      '/push-subscriptions/config',
      { schema: { tags, summary: 'VAPID public key (null when Web Push is disabled)', response: { 200: PushConfigResponse, ...errorResponses } } },
      async (request) => {
        requireActor(request);
        return { vapidPublicKey: deps.gateway.publicKey() };
      },
    );

    app.post(
      '/push-subscriptions',
      {
        schema: {
          tags,
          summary: 'Save this device\'s push subscription (upsert by endpoint; naturally idempotent)',
          body: PushSubscriptionRequest,
          response: { 201: PushSubscriptionResponse, ...errorResponses },
        },
      },
      async (request, reply) => {
        const actor = requireActor(request);
        const res = await deps.register.execute(actor.userId, request.body);
        return reply.status(201).send(res);
      },
    );

    app.delete(
      '/push-subscriptions/:id',
      { schema: { tags, summary: 'Remove one of your push subscriptions', params: IdParams, response: { 204: NoContent, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        await deps.remove.execute(actor.userId, request.params.id);
        return reply.status(204).send(null);
      },
    );
  };
}
