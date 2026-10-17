import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateMeasurementRequest,
  CreateWeightRequest,
  DeleteRequest,
  HistoryQuery,
  MeasurementPage,
  MeasurementSession,
  MutationMeta,
  PutWeightGoalRequest,
  UpdateMeasurementRequest,
  UpdateWeightRequest,
  WeightEntry,
  WeightGoal,
  WeightPage,
} from '@zelo/contracts';
import type { IdempotentExecutor } from '../../../../../shared/application/ports.js';
import { historyParams } from '../../../../../shared/application/repository-errors.js';
import { IdParams, errorResponses, executeOperation, requireActor, sendResult } from '../../../../../shared/http/index.js';
import type { BodyUseCases } from '../../../application/use-cases/index.js';

export const HISTORY_DESCRIPTION =
  'Cursor pagination ordered by measuredAt desc, id desc. `from` inclusive / `to` exclusive (ISO instants). ' +
  '`limit` default 50, max 200. Pass `nextCursor` from the previous page as `cursor`; `nextCursor` is null on the last page.';

export function bodyRoutes(uc: BodyUseCases, idempotency: IdempotentExecutor): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();

    // ----- weights -----
    app.get(
      '/weights',
      { schema: { tags: ['body'], summary: 'Weight history', description: HISTORY_DESCRIPTION, querystring: HistoryQuery, response: { 200: WeightPage, ...errorResponses } } },
      async (request) => uc.listWeights.execute(requireActor(request), historyParams(request.query)),
    );
    app.post(
      '/weights',
      { schema: { tags: ['body'], summary: 'Register a weight (idempotent by operationId)', body: CreateWeightRequest, response: { 201: WeightEntry, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'weight.create', entityId: body.id, payload: body }, async (tx) => ({
          status: 201,
          body: await uc.registerWeight.execute(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.patch(
      '/weights/:id',
      { schema: { tags: ['body'], summary: 'Edit a weight (expectedVersion)', params: IdParams, body: UpdateWeightRequest, response: { 200: WeightEntry, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'weight.update', entityId: id, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.updateWeight.execute(actor, id, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/weights/:id',
      { schema: { tags: ['body'], summary: 'Delete a weight (tombstone)', params: IdParams, body: DeleteRequest, response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'weight.delete', entityId: id, payload: body }, async (tx) => {
          await uc.deleteWeight.execute(actor, id, body.expectedVersion, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );

    // ----- weight goal -----
    app.get(
      '/weight-goal',
      { schema: { tags: ['body'], summary: 'Active weight goal (404 if none)', response: { 200: WeightGoal, ...errorResponses } } },
      async (request) => uc.weightGoal.get(requireActor(request)),
    );
    app.put(
      '/weight-goal',
      { schema: { tags: ['body'], summary: 'Set the weight goal (no automatic recommendation)', body: PutWeightGoalRequest, response: { 200: WeightGoal, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'weightGoal.put', entityId: actor.userId, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.weightGoal.put(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/weight-goal',
      { schema: { tags: ['body'], summary: 'Remove the weight goal', body: MutationMeta.optional(), response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        if (!body?.operationId) {
          await uc.uow.run((tx) => uc.weightGoal.remove(actor, tx));
          return reply.status(204).send(null);
        }
        const r = await executeOperation(idempotency, actor, { type: 'weightGoal.delete', entityId: actor.userId, payload: body }, async (tx) => {
          await uc.weightGoal.remove(actor, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );

    // ----- measurements -----
    app.get(
      '/measurements',
      { schema: { tags: ['body'], summary: 'Measurement sessions history', description: HISTORY_DESCRIPTION, querystring: HistoryQuery, response: { 200: MeasurementPage, ...errorResponses } } },
      async (request) => uc.listMeasurements.execute(requireActor(request), historyParams(request.query)),
    );
    app.post(
      '/measurements',
      { schema: { tags: ['body'], summary: 'Register a measurement session', body: CreateMeasurementRequest, response: { 201: MeasurementSession, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'measurement.create', entityId: body.id, payload: body }, async (tx) => ({
          status: 201,
          body: await uc.registerMeasurements.execute(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.patch(
      '/measurements/:id',
      { schema: { tags: ['body'], summary: 'Edit a measurement session', params: IdParams, body: UpdateMeasurementRequest, response: { 200: MeasurementSession, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'measurement.update', entityId: id, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.updateMeasurements.execute(actor, id, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/measurements/:id',
      { schema: { tags: ['body'], summary: 'Delete a measurement session (tombstone)', params: IdParams, body: DeleteRequest, response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'measurement.delete', entityId: id, payload: body }, async (tx) => {
          await uc.deleteMeasurements.execute(actor, id, body.expectedVersion, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );
  };
}
