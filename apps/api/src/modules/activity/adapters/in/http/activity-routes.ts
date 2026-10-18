import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ActivityGoal,
  ActivityToday,
  HEALTH_IMPORT_MAX_BYTES,
  HealthImportResponse,
  LocalDate,
  MutationMeta,
  PutActivityGoalRequest,
  StepsQuery,
  StepsSummary,
  Workout,
  WorkoutPage,
  WorkoutsQuery,
} from '@zelo/contracts';
import type { IdempotentExecutor } from '../../../../../shared/application/ports.js';
import { IdParams, errorResponses, executeOperation, requireActor, sendResult } from '../../../../../shared/http/index.js';
import type { ActivityUseCases } from '../../../application/use-cases/index.js';
import { parseHealthExport } from './health-export/health-export-parser.js';

/** Structural copy of the integrations module's authenticator port (injected by bootstrap). */
export interface BearerAuthenticator {
  authenticate(rawToken: string | undefined): Promise<{ userId: string; credentialId: string }>;
}

const tags = ['activity'];

function bearerToken(request: FastifyRequest): string | undefined {
  const h = request.headers.authorization;
  if (typeof h !== 'string') return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m?.[1];
}

/** Health Auto Export metadata headers (documented names; values are not documented → metadata only). */
function exportMetadata(request: FastifyRequest) {
  const pick = (name: string) => {
    const v = request.headers[name];
    return typeof v === 'string' ? v.slice(0, 100) : undefined;
  };
  return {
    automationId: pick('automation-id'),
    automationName: pick('automation-name'),
    automationAggregation: pick('automation-aggregation'),
    automationPeriod: pick('automation-period'),
    sessionId: pick('session-id'),
  };
}

export function activityRoutes(uc: ActivityUseCases, idempotency: IdempotentExecutor, auth: BearerAuthenticator): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();

    // ----- import (Health Auto Export → Zelo); bearer token, no session cookie, no CSRF -----
    app.post(
      '/imports/health',
      {
        bodyLimit: HEALTH_IMPORT_MAX_BYTES,
        config: { integrationAuth: true },
        // authenticate BEFORE the body is read/parsed: 401 wins over 413/400
        onRequest: async (request) => {
          const { userId } = await auth.authenticate(bearerToken(request));
          request.actor = { userId };
        },
        schema: {
          tags: ['imports'],
          summary: 'Health Auto Export receiver (REST API automation, JSON, workouts v2)',
          description:
            'Auth: `Authorization: Bearer <integration token>` (created by the admin script). Session cookie and CSRF are not used. ' +
            `Body ≤ ${HEALTH_IMPORT_MAX_BYTES} bytes, \`application/json\`, envelope {data:{metrics?, workouts?}}. ` +
            '400 invalid structure (fieldErrors by JSON path) · 401 missing/invalid/revoked token · 413 body too large · ' +
            '422 not a consolidated daily total (e.g. same day twice) · 500 persistence failure (safe to resend).',
          security: [{ integrationToken: [] }],
          response: { 200: HealthImportResponse, 413: errorResponses[400], 500: errorResponses[400], ...errorResponses },
        },
      },
      async (request) => {
        const actor = requireActor(request);
        const meta = exportMetadata(request);
        const parsed = parseHealthExport(request.body);
        const result = await uc.receiveHealthExport.execute(actor.userId, parsed);
        // counts + ids + metadata only — never the payload or the token
        request.log.info(
          { userId: actor.userId, ...meta, steps: result.steps, workouts: result.workouts, ignoredMetrics: parsed.ignoredMetrics },
          'health export received',
        );
        return result;
      },
    );

    // ----- reads (session) -----
    app.get(
      '/activity/today',
      { schema: { tags, summary: 'Received activity of a day (default: today in the profile tz)', querystring: z.object({ date: LocalDate.optional() }), response: { 200: ActivityToday, ...errorResponses } } },
      async (request) => uc.getActivityToday.forUser(requireActor(request).userId, request.query.date),
    );
    app.get(
      '/activity/steps',
      { schema: { tags, summary: 'Daily steps (one row per date; count null = no data) — max 400 days', querystring: StepsQuery, response: { 200: StepsSummary, ...errorResponses } } },
      async (request) => uc.getDailySteps.execute(requireActor(request), request.query),
    );
    app.get(
      '/activity/workouts',
      { schema: { tags, summary: 'Received workouts, startedAt desc (cursor pagination)', querystring: WorkoutsQuery, response: { 200: WorkoutPage, ...errorResponses } } },
      async (request) => uc.listWorkouts.execute(requireActor(request), request.query),
    );
    app.get(
      '/activity/workouts/:id',
      { schema: { tags, summary: 'Workout details (404 for other users)', params: IdParams, response: { 200: Workout, ...errorResponses } } },
      async (request) => uc.getWorkoutDetails.execute(requireActor(request), request.params.id),
    );

    // ----- steps goal -----
    app.get(
      '/activity/goal',
      { schema: { tags, summary: 'Daily steps goal (404 if none)', response: { 200: ActivityGoal, ...errorResponses } } },
      async (request) => uc.stepsGoal.get(requireActor(request)),
    );
    app.put(
      '/activity/goal',
      { schema: { tags, summary: 'Set the daily steps goal (idempotent by operationId)', body: PutActivityGoalRequest, response: { 200: ActivityGoal, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const r = await executeOperation(idempotency, actor, { type: 'activityGoal.put', entityId: actor.userId, payload: body }, async (tx) => ({
          status: 200,
          body: await uc.stepsGoal.put(actor, body, tx),
        }));
        return sendResult(reply, r);
      },
    );
    app.delete(
      '/activity/goal',
      { schema: { tags, summary: 'Remove the daily steps goal', body: MutationMeta.optional(), response: { 204: z.null(), ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        if (!body?.operationId) {
          await uc.uow.run((tx) => uc.stepsGoal.remove(actor, tx));
          return reply.status(204).send(null);
        }
        const r = await executeOperation(idempotency, actor, { type: 'activityGoal.delete', entityId: actor.userId, payload: body }, async (tx) => {
          await uc.stepsGoal.remove(actor, tx);
          return { status: 204, body: null };
        });
        return sendResult(reply, r);
      },
    );
  };
}
