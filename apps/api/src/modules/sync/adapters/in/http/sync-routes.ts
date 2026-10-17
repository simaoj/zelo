import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SyncBootstrapResponse, SyncChangesResponse, SyncOperation, SyncOperationsResponse, type SyncOperationResult } from '@zelo/contracts';
import { NotFoundError, ValidationError } from '../../../../../shared/domain/errors.js';
import { errorResponses, requireActor, toApiError } from '../../../../../shared/http/index.js';
import type { SyncService } from '../../../application/sync-service.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const LooseOperations = z.object({
  operations: z
    .array(z.object({ type: z.string(), entityId: z.string(), payload: z.unknown() }))
    .min(1)
    .max(100),
});

export function syncRoutes(service: SyncService): FastifyPluginAsync {
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    const tags = ['sync'];

    app.get(
      '/sync/bootstrap',
      {
        schema: {
          tags,
          summary: 'Consistent snapshot of every synced entity + opaque cursor (single snapshot transaction)',
          response: { 200: SyncBootstrapResponse, ...errorResponses },
        },
      },
      async (request, reply) => {
        const { cursor, data } = await service.bootstrap(requireActor(request));
        const profile = data.profile?.[0];
        if (!profile) throw new NotFoundError('Perfil');
        reply.header('cache-control', 'no-store');
        return {
          cursor,
          profile,
          weightEntries: data.weightEntry ?? [],
          weightGoal: data.weightGoal?.[0] ?? null,
          measurementSessions: data.measurementSession ?? [],
          bloodPressureEntries: data.bloodPressureEntry ?? [],
          routineItems: data.routineItem ?? [],
          occurrences: data.occurrence ?? [],
          intakeRecords: data.intakeRecord ?? [],
        } as z.infer<typeof SyncBootstrapResponse>;
      },
    );

    app.get(
      '/sync/changes',
      {
        schema: {
          tags,
          summary: 'Changes after the cursor (upserts with current data, or tombstones); repeat while hasMore',
          querystring: z.object({ cursor: z.string().min(1) }),
          response: { 200: SyncChangesResponse, ...errorResponses },
        },
      },
      async (request, reply) => {
        reply.header('cache-control', 'no-store');
        return (await service.changes(requireActor(request), request.query.cursor)) as z.infer<typeof SyncChangesResponse>;
      },
    );

    app.post(
      '/sync/operations',
      {
        schema: {
          tags,
          summary: 'Apply queued offline operations in order (same use cases as REST, idempotent by operationId); stops at first 401',
          description: `Body: { operations: SyncOperation[] } (1..100). Supported types: see SyncOperation in @zelo/contracts.`,
          body: LooseOperations,
          response: { 200: SyncOperationsResponse, ...errorResponses },
        },
      },
      async (request) => {
        const actor = requireActor(request);
        const results: SyncOperationResult[] = [];
        for (const raw of request.body.operations) {
          const rawOpId = (raw.payload as { operationId?: unknown } | null)?.operationId;
          const operationId = typeof rawOpId === 'string' && z.uuid().safeParse(rawOpId).success ? rawOpId : NIL_UUID;
          try {
            const parsed = SyncOperation.safeParse(raw);
            if (!parsed.success) {
              const fieldErrors: Record<string, string[]> = {};
              for (const i of parsed.error.issues) (fieldErrors[i.path.join('.') || '_'] ??= []).push(i.message);
              throw new ValidationError('Operação inválida', fieldErrors);
            }
            const op = parsed.data;
            const r = await service.executeOperation(actor, { type: op.type, entityId: op.entityId, payload: op.payload as { operationId: string } & Record<string, unknown> });
            results.push(r.status === 204 || r.body === null ? { operationId, status: r.status } : { operationId, status: r.status, body: r.body });
          } catch (err) {
            const { status, body } = toApiError(err, request.correlationId);
            if (status >= 500) request.log.error({ err, type: raw.type }, 'sync operation failed');
            results.push({ operationId, status, error: body });
            if (status === 401) break;
          }
        }
        return { results };
      },
    );
  };
}
