import type { IntakeRecord as IntakeDto, Occurrence as OccurrenceDto } from '@zelo/contracts';
import type { TxContext } from '../../../../shared/application/ports.js';
import { NotFoundError, ValidationError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { assertNotArchived } from '../../domain/entities/routine-item.js';
import type { Occurrence } from '../../domain/entities/occurrence.js';
import {
  editIntake,
  newIntake,
  replaceDecision,
  softDelete,
  type IntakeRecord,
} from '../../domain/entities/intake-record.js';
import type { RoutineAppDeps } from '../deps.js';
import { toIntakeDto, toOccurrenceDto } from '../presenters.js';
import type { Result } from './routine-items.js';

export interface PutIntakeInput {
  intakeId: string;
  status: string;
  actualTakenAt: Date | null;
  notes?: string | null | undefined;
  expectedVersion?: number | undefined;
}

abstract class IntakeUseCase {
  constructor(protected readonly d: RoutineAppDeps) {}

  protected async loadOccurrence(userId: string, occurrenceId: string, tx: TxContext): Promise<Occurrence> {
    const occ = await this.d.occurrences.getById(userId, occurrenceId, tx);
    if (!occ) throw new NotFoundError('Dose programada');
    return occ;
  }

  protected async occurrenceDto(occ: Occurrence, tx: TxContext): Promise<OccurrenceDto> {
    const live = await this.d.intakes.getLiveByOccurrence(occ.userId, occ.id, tx);
    return toOccurrenceDto(occ, live, this.d.clock.now());
  }

  protected async record(tx: TxContext, intake: IntakeRecord, op: 'upsert' | 'delete'): Promise<void> {
    await this.d.changeLog.record(tx, intake.userId, { entity: 'intakeRecord', id: intake.id, op });
    // the occurrence representation embeds its intake/state → it changed too
    if (intake.occurrenceId) {
      await this.d.changeLog.record(tx, intake.userId, { entity: 'occurrence', id: intake.occurrenceId, op: 'upsert' });
    }
  }

  protected async loadLiveIntake(userId: string, id: string, expectedVersion: number, tx: TxContext): Promise<IntakeRecord> {
    const intake = await this.d.intakes.getById(userId, id, tx);
    if (!intake || intake.deletedAt) throw new NotFoundError('Registro');
    if (intake.version !== expectedVersion) throw new VersionConflictError(toIntakeDto(intake));
    return intake;
  }

  protected async persist(updated: IntakeRecord, expectedVersion: number, tx: TxContext): Promise<void> {
    if (!(await this.d.intakes.update(updated, expectedVersion, tx))) {
      const current = await this.d.intakes.getById(updated.userId, updated.id, tx);
      throw new VersionConflictError(current && !current.deletedAt ? toIntakeDto(current) : undefined);
    }
  }
}

/**
 * RecordIntake — PUT /occurrences/:id/intake. Creates the decision, or replaces the live one
 * (replacement requires expectedVersion). Snapshots come from the occurrence and are kept on replace.
 * The partial unique index on live linked records guarantees at most one decision per occurrence.
 */
export class RecordIntake extends IntakeUseCase {
  async execute(userId: string, occurrenceId: string, input: PutIntakeInput, tx: TxContext): Promise<Result<OccurrenceDto>> {
    const now = this.d.clock.now();
    const occ = await this.loadOccurrence(userId, occurrenceId, tx);
    if (occ.cancelledAt) {
      throw new ValidationError('Esta dose foi cancelada por uma alteração na programação', { occurrence: ['Dose cancelada'] });
    }
    const existing = await this.d.intakes.getLiveByOccurrence(userId, occ.id, tx);

    if (existing) {
      if (input.expectedVersion === undefined || input.expectedVersion !== existing.version) {
        throw new VersionConflictError(toOccurrenceDto(occ, existing, now));
      }
      const updated = replaceDecision(existing, { ...input, scheduledAt: occ.scheduledAt }, now);
      await this.persist(updated, existing.version, tx);
      await this.record(tx, updated, 'upsert');
      return { status: 200, body: toOccurrenceDto(occ, updated, now) };
    }

    const fresh = newIntake({
      id: input.intakeId,
      userId,
      itemId: occ.itemId,
      occurrenceId: occ.id,
      status: input.status,
      actualTakenAt: input.actualTakenAt,
      notes: input.notes,
      snapshot: { nameSnapshot: occ.nameSnapshot, doseSnapshot: occ.doseSnapshot, unitSnapshot: occ.unitSnapshot },
      scheduledAt: occ.scheduledAt,
      now,
    });

    const sameId = await this.d.intakes.getById(userId, input.intakeId, tx);
    if (sameId && sameId.deletedAt && sameId.occurrenceId === occ.id) {
      // client re-used the id of an undone decision for the same occurrence → revive it
      const revived: IntakeRecord = { ...fresh, createdAt: sameId.createdAt, version: sameId.version + 1 };
      await this.persist(revived, sameId.version, tx);
      await this.record(tx, revived, 'upsert');
      return { status: 200, body: toOccurrenceDto(occ, revived, now) };
    }
    if (sameId || (await this.d.intakes.idExists(input.intakeId, tx))) {
      throw new ValidationError('Identificador já utilizado', { intakeId: ['Identificador já utilizado'] });
    }
    await this.d.intakes.insert(fresh, tx);
    await this.record(tx, fresh, 'upsert');
    return { status: 201, body: toOccurrenceDto(occ, fresh, now) };
  }
}

/** UndoIntake — DELETE /occurrences/:id/intake: soft-deletes the live decision (occurrence goes back to scheduled/unrecorded). */
export class UndoIntake extends IntakeUseCase {
  async execute(userId: string, occurrenceId: string, input: { expectedVersion: number }, tx: TxContext): Promise<Result<null>> {
    const now = this.d.clock.now();
    const occ = await this.loadOccurrence(userId, occurrenceId, tx);
    const existing = await this.d.intakes.getLiveByOccurrence(userId, occ.id, tx);
    if (!existing) throw new NotFoundError('Registro');
    if (existing.version !== input.expectedVersion) throw new VersionConflictError(toOccurrenceDto(occ, existing, now));
    const deleted = softDelete(existing, now);
    await this.persist(deleted, existing.version, tx);
    await this.record(tx, deleted, 'delete');
    return { status: 204, body: null };
  }
}

/** POST /intakes — ad-hoc intake of an existing own (non-archived) item; never confirms an occurrence. */
export class CreateAdHocIntake extends IntakeUseCase {
  async execute(
    userId: string,
    input: { id: string; itemId: string; actualTakenAt: Date; notes?: string | null | undefined },
    tx: TxContext,
  ): Promise<Result<IntakeDto>> {
    const now = this.d.clock.now();
    const item = await this.d.routines.getItem(userId, input.itemId, tx);
    if (!item) throw new NotFoundError('Item');
    assertNotArchived(item);
    if (await this.d.intakes.idExists(input.id, tx)) {
      throw new ValidationError('Identificador já utilizado', { id: ['Identificador já utilizado'] });
    }
    const intake = newIntake({
      id: input.id,
      userId,
      itemId: item.id,
      occurrenceId: null,
      status: 'taken',
      actualTakenAt: input.actualTakenAt,
      notes: input.notes,
      snapshot: { nameSnapshot: item.name, doseSnapshot: item.currentDose, unitSnapshot: item.currentUnit },
      scheduledAt: null,
      now,
    });
    await this.d.intakes.insert(intake, tx);
    await this.record(tx, intake, 'upsert');
    return { status: 201, body: toIntakeDto(intake) };
  }
}

/** PATCH /intakes/:id */
export class EditIntake extends IntakeUseCase {
  async execute(
    userId: string,
    id: string,
    input: { expectedVersion: number; actualTakenAt?: Date | undefined; notes?: string | null | undefined },
    tx: TxContext,
  ): Promise<Result<IntakeDto>> {
    const intake = await this.loadLiveIntake(userId, id, input.expectedVersion, tx);
    const updated = editIntake(intake, input, this.d.clock.now());
    await this.persist(updated, intake.version, tx);
    await this.record(tx, updated, 'upsert');
    return { status: 200, body: toIntakeDto(updated) };
  }
}

/** DELETE /intakes/:id (soft delete → tombstone) */
export class DeleteIntake extends IntakeUseCase {
  async execute(userId: string, id: string, input: { expectedVersion: number }, tx: TxContext): Promise<Result<null>> {
    const intake = await this.loadLiveIntake(userId, id, input.expectedVersion, tx);
    const deleted = softDelete(intake, this.d.clock.now());
    await this.persist(deleted, intake.version, tx);
    await this.record(tx, deleted, 'delete');
    return { status: 204, body: null };
  }
}
