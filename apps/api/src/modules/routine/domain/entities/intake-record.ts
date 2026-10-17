import { ValidationError } from '../../../../shared/domain/errors.js';

export type IntakeStatus = 'taken' | 'not_taken';

export interface IntakeRecord {
  id: string;
  userId: string;
  itemId: string;
  /** null for ad-hoc intakes (persisted by omitting the field) */
  occurrenceId: string | null;
  status: IntakeStatus;
  /** required for `taken`, null for `not_taken`; never in the future */
  actualTakenAt: Date | null;
  notes: string | null;
  nameSnapshot: string;
  doseSnapshot: string;
  unitSnapshot: string;
  /**
   * Sort key for history: actualTakenAt, or the occurrence's scheduledAt for `not_taken`.
   * Persisted so history can be cursor-paginated on a single index.
   */
  sortAt: Date;
  deletedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tolerance for client clock skew when checking "never in the future".
 * A device clock a few seconds ahead must not reject "taken now".
 */
export const FUTURE_TOLERANCE_MS = 60_000;

export function validateNotes(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v.length > 1000) throw new ValidationError('Observação muito longa', { notes: ['Use até 1000 caracteres'] });
  return v.length === 0 ? null : v;
}

export function validateDecision(status: string, actualTakenAt: Date | null, now: Date): { status: IntakeStatus; actualTakenAt: Date | null } {
  if (status !== 'taken' && status !== 'not_taken') {
    throw new ValidationError('Status inválido', { status: ['Status inválido'] });
  }
  if (status === 'not_taken') return { status, actualTakenAt: null };
  if (!actualTakenAt || Number.isNaN(actualTakenAt.getTime())) {
    throw new ValidationError('Informe o horário em que tomou', { actualTakenAt: ['Informe o horário em que tomou'] });
  }
  assertNotFuture(actualTakenAt, now);
  return { status, actualTakenAt };
}

export function assertNotFuture(at: Date, now: Date): void {
  if (at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new ValidationError('O horário não pode estar no futuro', { actualTakenAt: ['O horário não pode estar no futuro'] });
  }
}

export interface Snapshot {
  nameSnapshot: string;
  doseSnapshot: string;
  unitSnapshot: string;
}

export function newIntake(input: {
  id: string;
  userId: string;
  itemId: string;
  occurrenceId: string | null;
  status: string;
  actualTakenAt: Date | null;
  notes?: string | null | undefined;
  snapshot: Snapshot;
  /** fallback sort key for not_taken (occurrence scheduledAt) */
  scheduledAt: Date | null;
  now: Date;
}): IntakeRecord {
  const decision = validateDecision(input.status, input.actualTakenAt, input.now);
  return {
    id: input.id,
    userId: input.userId,
    itemId: input.itemId,
    occurrenceId: input.occurrenceId,
    ...decision,
    notes: validateNotes(input.notes),
    ...input.snapshot,
    sortAt: decision.actualTakenAt ?? input.scheduledAt ?? input.now,
    deletedAt: null,
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Replaces the decision of a live intake (PUT on an occurrence that already has one). Snapshots are kept. */
export function replaceDecision(
  intake: IntakeRecord,
  input: { status: string; actualTakenAt: Date | null; notes?: string | null | undefined; scheduledAt: Date | null },
  now: Date,
): IntakeRecord {
  const decision = validateDecision(input.status, input.actualTakenAt, now);
  return {
    ...intake,
    ...decision,
    notes: input.notes !== undefined ? validateNotes(input.notes) : intake.notes,
    sortAt: decision.actualTakenAt ?? input.scheduledAt ?? intake.sortAt,
    version: intake.version + 1,
    updatedAt: now,
  };
}

/** PATCH /intakes/:id — edit time and/or notes. */
export function editIntake(
  intake: IntakeRecord,
  patch: { actualTakenAt?: Date | undefined; notes?: string | null | undefined },
  now: Date,
): IntakeRecord {
  assertLive(intake);
  let actualTakenAt = intake.actualTakenAt;
  if (patch.actualTakenAt !== undefined) {
    if (intake.status !== 'taken') {
      throw new ValidationError('Só é possível informar horário para doses tomadas', { actualTakenAt: ['Só é possível informar horário para doses tomadas'] });
    }
    assertNotFuture(patch.actualTakenAt, now);
    actualTakenAt = patch.actualTakenAt;
  }
  return {
    ...intake,
    actualTakenAt,
    notes: patch.notes !== undefined ? validateNotes(patch.notes) : intake.notes,
    sortAt: actualTakenAt ?? intake.sortAt,
    version: intake.version + 1,
    updatedAt: now,
  };
}

export function assertLive(intake: IntakeRecord): void {
  if (intake.deletedAt) throw new ValidationError('Registro já removido');
}

export function softDelete(intake: IntakeRecord, now: Date): IntakeRecord {
  return { ...intake, deletedAt: now, version: intake.version + 1, updatedAt: now };
}
