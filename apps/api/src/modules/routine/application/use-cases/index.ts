import type { CreateIntakeRequest, PutOccurrenceIntakeRequest } from '@zelo/contracts';
import type { TxContext } from '../../../../shared/application/ports.js';
import type { RoutineAppDeps } from '../deps.js';
import { GenerateOccurrences } from './generate-occurrences.js';
import { CreateAdHocIntake, DeleteIntake, EditIntake, RecordIntake, UndoIntake } from './intakes.js';
import { ListIntakes, ListOccurrences } from './queries.js';
import { ArchiveRoutineItem, CreateRoutineItem, ListRoutineItems, ReviseSchedule, UpdateRoutineItem } from './routine-items.js';

/** All routine use cases wired on the same deps. HTTP, sync and jobs call these — never duplicate rules. */
export function createRoutineUseCases(d: RoutineAppDeps) {
  const recordIntake = new RecordIntake(d);
  const createAdHocIntake = new CreateAdHocIntake(d);
  return {
    createItem: new CreateRoutineItem(d),
    updateItem: new UpdateRoutineItem(d),
    reviseSchedule: new ReviseSchedule(d),
    archiveItem: new ArchiveRoutineItem(d),
    listItems: new ListRoutineItems(d),
    generate: new GenerateOccurrences(d),
    listOccurrences: new ListOccurrences(d),
    recordIntake,
    undoIntake: new UndoIntake(d),
    createAdHocIntake,
    editIntake: new EditIntake(d),
    deleteIntake: new DeleteIntake(d),
    listIntakes: new ListIntakes(d),
    /** contract request → RecordIntake */
    putIntake: (userId: string, occurrenceId: string, body: PutOccurrenceIntakeRequest, tx: TxContext) =>
      recordIntake.execute(
        userId,
        occurrenceId,
        {
          intakeId: body.intakeId,
          status: body.status,
          actualTakenAt: body.actualTakenAt ? new Date(body.actualTakenAt) : null,
          notes: body.notes,
          expectedVersion: body.expectedVersion,
        },
        tx,
      ),
    /** contract request → CreateAdHocIntake */
    createAdHoc: (userId: string, body: CreateIntakeRequest, tx: TxContext) =>
      createAdHocIntake.execute(userId, { id: body.id, itemId: body.itemId, actualTakenAt: new Date(body.actualTakenAt), notes: body.notes }, tx),
  };
}

export type RoutineUseCases = ReturnType<typeof createRoutineUseCases>;
