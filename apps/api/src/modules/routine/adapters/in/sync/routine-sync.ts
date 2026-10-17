import { CreateIntakeRequest, DeleteRequest, PutOccurrenceIntakeRequest } from '@zelo/contracts';
import type { z } from 'zod';
import type { SyncOperationHandler, SyncReader } from '../../../../../bootstrap/module-contract.js';
import { ValidationError } from '../../../../../shared/domain/errors.js';
import type { RoutineUseCases } from '../../../application/use-cases/index.js';
import { OP } from '../operation-types.js';

function parse<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const r = schema.safeParse(payload);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of r.error.issues) (fieldErrors[issue.path.join('.') || '_'] ??= []).push(issue.message);
  throw new ValidationError('Confira os campos informados.', fieldErrors);
}

/** Offline operations (spec §9): the SAME use cases as the REST endpoints, inside the dispatcher's tx. */
export function routineSyncHandlers(uc: RoutineUseCases): SyncOperationHandler[] {
  return [
    {
      type: OP.intakePut,
      handle: (actor, occurrenceId, payload, tx) => uc.putIntake(actor.userId, occurrenceId, parse(PutOccurrenceIntakeRequest, payload), tx),
    },
    {
      type: OP.intakeUndo,
      handle: (actor, occurrenceId, payload, tx) => uc.undoIntake.execute(actor.userId, occurrenceId, parse(DeleteRequest, payload), tx),
    },
    {
      type: OP.intakeCreate,
      handle: (actor, entityId, payload, tx) => {
        const body = parse(CreateIntakeRequest, payload);
        if (body.id !== entityId) throw new ValidationError('entityId diferente do id do registro', { id: ['Identificador inconsistente'] });
        return uc.createAdHoc(actor.userId, body, tx);
      },
    },
  ];
}

export function routineSyncReaders(uc: RoutineUseCases): SyncReader[] {
  return [
    {
      entity: 'routineItem',
      getById: (userId, id, tx) => uc.listItems.byId(userId, id, tx),
      listForBootstrap: (userId, tx) => uc.listItems.execute(userId, true, tx),
    },
    {
      entity: 'occurrence',
      // cancelled → null → tombstone
      getById: (userId, id, tx) => uc.listOccurrences.byId(userId, id, tx),
      listForBootstrap: (userId, tx) => uc.listOccurrences.forBootstrap(userId, tx),
    },
    {
      entity: 'intakeRecord',
      // soft-deleted → null → tombstone
      getById: (userId, id, tx) => uc.listIntakes.byId(userId, id, tx),
      listForBootstrap: (userId, tx) => uc.listIntakes.allLive(userId, tx),
    },
  ];
}
