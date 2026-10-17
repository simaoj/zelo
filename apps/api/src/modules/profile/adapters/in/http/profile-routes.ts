import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { Profile, UpdateProfileRequest } from '@zelo/contracts';
import type { IdempotentExecutor } from '../../../../../shared/application/ports.js';
import { errorResponses, executeOperation, requireActor, sendResult } from '../../../../../shared/http/index.js';
import type { GetProfile, UpdateProfile } from '../../../application/use-cases/profile-use-cases.js';

export function profileRoutes(deps: {
  getProfile: GetProfile;
  updateProfile: UpdateProfile;
  idempotency: IdempotentExecutor;
}): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    app.get(
      '/profile',
      { schema: { tags: ['profile'], summary: 'Current user profile', response: { 200: Profile, ...errorResponses } } },
      async (request) => deps.getProfile.execute(requireActor(request)),
    );
    app.patch(
      '/profile',
      { schema: { tags: ['profile'], summary: 'Update profile (versioned, idempotent)', body: UpdateProfileRequest, response: { 200: Profile, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const result = await executeOperation(
          deps.idempotency,
          actor,
          { type: 'profile.update', entityId: actor.userId, payload: body },
          async (tx) => ({ status: 200, body: await deps.updateProfile.execute(actor, body, tx) }),
        );
        return sendResult(reply, result);
      },
    );
  };
}
