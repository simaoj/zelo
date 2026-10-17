import type { RoutineItemType } from './routine-item.js';
import type { IntakeRecord } from './intake-record.js';

export interface Occurrence {
  id: string;
  userId: string;
  itemId: string;
  scheduleVersionId: string;
  /** UTC instant */
  scheduledAt: Date;
  /** local date/time in the SCHEDULE timezone */
  localDate: string;
  localTime: string;
  nameSnapshot: string;
  doseSnapshot: string;
  unitSnapshot: string;
  itemType: RoutineItemType;
  cancelledAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export type OccurrenceState = 'scheduled' | 'unrecorded' | 'taken' | 'not_taken';

/**
 * Derived display state. An occurrence whose time has passed WITHOUT a decision is
 * `unrecorded` forever — it never becomes `not_taken` automatically (spec §5.6).
 */
export function deriveState(occurrence: Pick<Occurrence, 'scheduledAt'>, liveIntake: Pick<IntakeRecord, 'status'> | null, now: Date): OccurrenceState {
  if (liveIntake) return liveIntake.status;
  return occurrence.scheduledAt.getTime() > now.getTime() ? 'scheduled' : 'unrecorded';
}

/**
 * Occurrences that a revision/archival may cancel: future (scheduledAt >= cutoff),
 * not already cancelled and WITHOUT a recorded decision.
 */
export function selectFuturePending<T extends Pick<Occurrence, 'id' | 'scheduledAt' | 'cancelledAt'>>(
  occurrences: T[],
  decidedOccurrenceIds: ReadonlySet<string>,
  cutoff: Date,
): T[] {
  return occurrences.filter(
    (o) => o.cancelledAt === null && o.scheduledAt.getTime() >= cutoff.getTime() && !decidedOccurrenceIds.has(o.id),
  );
}
