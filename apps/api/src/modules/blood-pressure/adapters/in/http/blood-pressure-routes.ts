import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { BloodPressureEntry, BloodPressurePage, CreateBloodPressureRequest, DeleteRequest, HistoryQuery, UpdateBloodPressureRequest } from '@zelo/contracts';
import type { IdempotentExecutor } from '../../../../../shared/application/ports.js';
import { historyParams } from '../../../../../shared/application/repository-errors.js';
import { IdParams, errorResponses, executeOperation, requireActor, sendResult } from '../../../../../shared/http/index.js';
import type { BloodPressureUseCases } from '../../../application/use-cases/blood-pressure.js';

const HISTORY_DESCRIPTION =
  'Cursor pagination ordered by measuredAt desc, id desc. `from` inclusive / `to` exclusive (ISO instants). ' +
  '`limit` default 50, max 200. Pass `nextCursor` as `cursor`; null on the last page.';

export function bloodPressureRoutes(uc: BloodPressureUseCases, idempotency: IdempotentExecutor): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    const tags = ['blood-pressure'];
    app.get(
      '/blood-pressure',
      { schema: { tags, summary: 'Blood pressure history', description: HISTORY_DESCRIPTION, querystring: HistoryQuery, response: { 200: BloodPressurePage, ...errorResponses } } },
      async (request) => uc.list.execute(requireActor(request), historyParams(request.query)),
    );
    app.post(
      '/blood-pressure',
      {
        schema: {
          tags,
          summary: 'Register a reading (422 CONFIRMATION_REQUIRED when diastolic >= systolic without confirmedUnusual)',
          body: CreateBloodPressureRequest,
          response: { 201: BloodPressureEntry, ...errorResponses },
        },
      },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'bloodPressure.create', entityId: body.id, payload: body }, async (tx) => ({
          status: 201,
          body: await uc.register.execute(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.patch(
      '/blood-pressure/:id',
      { schema: { tags, summary: 'Edit a reading (expectedVersion)', params: IdParams, body: UpdateBloodPressureRequest, response: { 200: BloodPressureEntry, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'bloodPressure.update', entityId: id, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.update.execute(actor, id, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/blood-pressure/:id',
      { schema: { tags, summary: 'Delete a reading (tombstone)', params: IdParams, body: DeleteRequest, response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'bloodPressure.delete', entityId: id, payload: body }, async (tx) => {
          await uc.remove.execute(actor, id, body.expectedVersion, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );
  };
}
