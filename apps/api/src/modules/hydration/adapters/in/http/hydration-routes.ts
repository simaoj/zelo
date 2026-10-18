import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateWaterEntryRequest,
  DeleteRequest,
  HistoryQuery,
  HydrationGoal,
  HydrationSummary,
  HydrationSummaryQuery,
  MutationMeta,
  PutHydrationGoalRequest,
  UpdateWaterEntryRequest,
  WaterEntry,
  WaterEntryPage,
} from '@zelo/contracts';
import type { IdempotentExecutor } from '../../../../../shared/application/ports.js';
import { historyParams } from '../../../../../shared/application/repository-errors.js';
import { IdParams, errorResponses, executeOperation, requireActor, sendResult } from '../../../../../shared/http/index.js';
import type { HydrationUseCases } from '../../../application/use-cases/index.js';

const HISTORY_DESCRIPTION =
  'Cursor pagination ordered by consumedAt desc, id desc. `from` inclusive / `to` exclusive (ISO instants). ' +
  '`limit` default 50, max 200. Pass `nextCursor` from the previous page as `cursor`; `nextCursor` is null on the last page.';

/** Operation types shared with the sync dispatcher (REST and /sync/operations replay each other). */
export const WATER_OPS = { create: 'water.create', update: 'water.update', delete: 'water.delete' } as const;

export function hydrationRoutes(uc: HydrationUseCases, idempotency: IdempotentExecutor): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    const tags = ['hydration'];

    // ----- water entries -----
    app.get(
      '/water-entries',
      { schema: { tags, summary: 'Water intake history', description: HISTORY_DESCRIPTION, querystring: HistoryQuery, response: { 200: WaterEntryPage, ...errorResponses } } },
      async (request) => uc.listWaterEntries.execute(requireActor(request), historyParams(request.query)),
    );
    app.post(
      '/water-entries',
      { schema: { tags, summary: 'Register water intake (idempotent by operationId)', body: CreateWaterEntryRequest, response: { 201: WaterEntry, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: WATER_OPS.create, entityId: body.id, payload: body }, async (tx) => ({
          status: 201,
          body: await uc.registerWaterIntake.execute(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.patch(
      '/water-entries/:id',
      { schema: { tags, summary: 'Edit water intake (expectedVersion)', params: IdParams, body: UpdateWaterEntryRequest, response: { 200: WaterEntry, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: WATER_OPS.update, entityId: id, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.updateWaterIntake.execute(actor, id, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/water-entries/:id',
      { schema: { tags, summary: 'Delete water intake (tombstone)', params: IdParams, body: DeleteRequest, response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: WATER_OPS.delete, entityId: id, payload: body }, async (tx) => {
          await uc.deleteWaterIntake.execute(actor, id, body.expectedVersion, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );

    // ----- summary -----
    app.get(
      '/hydration/summary',
      {
        schema: {
          tags,
          summary: 'Daily water totals (profile tz)',
          description: 'One row per local date in [from, to] (inclusive, max 400 days). `totalMl` is null when the day has no records (never 0 for absence).',
          querystring: HydrationSummaryQuery,
          response: { 200: HydrationSummary, ...errorResponses },
        },
      },
      async (request) => uc.getHydrationSummary.execute(requireActor(request), request.query),
    );

    // ----- goal -----
    app.get(
      '/hydration/goal',
      { schema: { tags, summary: 'Active daily water goal (404 if none)', response: { 200: HydrationGoal, ...errorResponses } } },
      async (request) => uc.hydrationGoal.get(requireActor(request)),
    );
    app.put(
      '/hydration/goal',
      { schema: { tags, summary: 'Set the daily water goal (no automatic recommendation)', body: PutHydrationGoalRequest, response: { 200: HydrationGoal, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'hydrationGoal.put', entityId: actor.userId, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.hydrationGoal.set(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/hydration/goal',
      { schema: { tags, summary: 'Remove the daily water goal', body: MutationMeta.optional(), response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        if (!body?.operationId) {
          await uc.uow.run((tx) => uc.hydrationGoal.remove(actor, tx));
          return reply.status(204).send(null);
        }
        const r = await executeOperation(idempotency, actor, { type: 'hydrationGoal.delete', entityId: actor.userId, payload: body }, async (tx) => {
          await uc.hydrationGoal.remove(actor, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );
  };
}
