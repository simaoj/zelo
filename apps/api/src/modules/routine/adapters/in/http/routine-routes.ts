import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ArchiveRoutineItemRequest,
  CreateIntakeRequest,
  CreateRoutineItemRequest,
  DeleteRequest,
  HistoryQuery,
  Id,
  IntakePage,
  IntakeRecord,
  LocalDate,
  Occurrence,
  OccurrenceList,
  PutOccurrenceIntakeRequest,
  ReviseScheduleRequest,
  RoutineItem,
  RoutineItemList,
  UpdateIntakeRequest,
  UpdateRoutineItemRequest,
} from '@zelo/contracts';
import type { IdempotentExecutor } from '../../../../../shared/application/ports.js';
import { errorResponses, executeOperation, IdParams, NoContent, requireActor, sendResult } from '../../../../../shared/http/index.js';
import type { RoutineUseCases } from '../../../application/use-cases/index.js';
import { OP } from '../operation-types.js';

const IncludeArchivedQuery = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
const DateQuery = z.object({ date: LocalDate.optional() });
const IntakeQuery = HistoryQuery.extend({ itemId: Id.optional() });

export function routineRoutes(deps: { uc: RoutineUseCases; idempotency: IdempotentExecutor }): FastifyPluginAsync {
  const { uc, idempotency } = deps;
  return async (root) => {
    const app = root.withTypeProvider<ZodTypeProvider>();
    const tags = ['routine'];

    // ---------- items ----------
    app.get(
      '/routine-items',
      { schema: { tags, summary: 'List routine items', querystring: IncludeArchivedQuery, response: { 200: RoutineItemList, ...errorResponses } } },
      async (request) => {
        const actor = requireActor(request);
        return { items: await uc.listItems.execute(actor.userId, request.query.includeArchived) };
      },
    );

    app.post(
      '/routine-items',
      { schema: { tags, summary: 'Create routine item with its first schedule', body: CreateRoutineItemRequest, response: { 201: RoutineItem, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.itemCreate, entityId: body.id, payload: body }, (tx) =>
          uc.createItem.execute(actor.userId, { ...body, instructions: body.instructions ?? null }, tx),
        );
        return sendResult(reply, result);
      },
    );

    app.patch(
      '/routine-items/:id',
      { schema: { tags, summary: 'Edit name/type/instructions', params: IdParams, body: UpdateRoutineItemRequest, response: { 200: RoutineItem, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.itemUpdate, entityId: id, payload: body }, (tx) =>
          uc.updateItem.execute(actor.userId, id, body, tx),
        );
        return sendResult(reply, result);
      },
    );

    app.post(
      '/routine-items/:id/archive',
      { schema: { tags, summary: 'Archive item (cancels future pending occurrences, keeps history)', params: IdParams, body: ArchiveRoutineItemRequest, response: { 200: RoutineItem, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.itemArchive, entityId: id, payload: body }, (tx) =>
          uc.archiveItem.execute(actor.userId, id, body, tx),
        );
        return sendResult(reply, result);
      },
    );

    app.post(
      '/routine-items/:id/schedules',
      { schema: { tags, summary: 'Revise schedule/dose (new version effective now)', params: IdParams, body: ReviseScheduleRequest, response: { 200: RoutineItem, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.scheduleRevise, entityId: id, payload: body }, (tx) =>
          uc.reviseSchedule.execute(actor.userId, id, body, tx),
        );
        return sendResult(reply, result);
      },
    );

    // ---------- occurrences ----------
    app.get(
      '/occurrences',
      {
        schema: {
          tags,
          summary: 'Occurrences of a day',
          description:
            '`date` (default: today) is a local date in the PROFILE timezone; returns every live occurrence whose instant falls in that day. Occurrences themselves are generated in the SCHEDULE timezone (their localDate/localTime are schedule-local).',
          querystring: DateQuery,
          response: { 200: OccurrenceList, ...errorResponses },
        },
      },
      async (request) => {
        const actor = requireActor(request);
        return uc.listOccurrences.forDate(actor.userId, request.query.date);
      },
    );

    app.put(
      '/occurrences/:id/intake',
      {
        schema: {
          tags,
          summary: 'Record (create or replace) the decision for an occurrence',
          description: 'Replacing an existing decision requires expectedVersion (the intake version). Returns the occurrence with its intake.',
          params: IdParams,
          body: PutOccurrenceIntakeRequest,
          response: { 200: Occurrence, 201: Occurrence, ...errorResponses },
        },
      },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.intakePut, entityId: id, payload: body }, (tx) =>
          uc.putIntake(actor.userId, id, body, tx),
        );
        return sendResult(reply, result);
      },
    );

    app.delete(
      '/occurrences/:id/intake',
      { schema: { tags, summary: 'Undo the decision (soft delete)', params: IdParams, body: DeleteRequest, response: { 204: NoContent, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.intakeUndo, entityId: id, payload: body }, (tx) =>
          uc.undoIntake.execute(actor.userId, id, body, tx),
        );
        return sendResult(reply, result);
      },
    );

    // ---------- intakes ----------
    app.get(
      '/intakes',
      { schema: { tags, summary: 'Intake history (cursor, newest first)', querystring: IntakeQuery, response: { 200: IntakePage, ...errorResponses } } },
      async (request) => {
        const actor = requireActor(request);
        return uc.listIntakes.execute(actor.userId, request.query);
      },
    );

    app.post(
      '/intakes',
      { schema: { tags, summary: 'Ad-hoc intake (does not confirm any occurrence)', body: CreateIntakeRequest, response: { 201: IntakeRecord, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.intakeCreate, entityId: body.id, payload: body }, (tx) =>
          uc.createAdHoc(actor.userId, body, tx),
        );
        return sendResult(reply, result);
      },
    );

    app.patch(
      '/intakes/:id',
      { schema: { tags, summary: 'Edit intake time/notes', params: IdParams, body: UpdateIntakeRequest, response: { 200: IntakeRecord, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.intakeUpdate, entityId: id, payload: body }, (tx) =>
          uc.editIntake.execute(
            actor.userId,
            id,
            { expectedVersion: body.expectedVersion, actualTakenAt: body.actualTakenAt ? new Date(body.actualTakenAt) : undefined, notes: body.notes },
            tx,
          ),
        );
        return sendResult(reply, result);
      },
    );

    app.delete(
      '/intakes/:id',
      { schema: { tags, summary: 'Delete intake (soft delete)', params: IdParams, body: DeleteRequest, response: { 204: NoContent, ...errorResponses } } },
      async (request, reply) => {
        const actor = requireActor(request);
        const { id } = request.params;
        const body = request.body;
        const result = await executeOperation(idempotency, actor, { type: OP.intakeDelete, entityId: id, payload: body }, (tx) =>
          uc.deleteIntake.execute(actor.userId, id, body, tx),
        );
        return sendResult(reply, result);
      },
    );
  };
}
