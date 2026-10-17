import { OCCURRENCE_STATE_LABELS, type Occurrence, type OccurrenceState } from '@zelo/contracts';

export interface OccurrenceView {
  label: string;
  /** visual tone; never the only signal (label + icon always shown) */
  tone: 'neutral' | 'attention' | 'done' | 'skipped';
  icon: 'clock' | 'circle-dashed' | 'check' | 'x';
}

/**
 * Display state. "Não registrado" is shown when time has passed without a decision;
 * it is NEVER converted to "Não tomado" automatically.
 */
export function occurrenceView(state: OccurrenceState): OccurrenceView {
  switch (state) {
    case 'scheduled':
      return { label: OCCURRENCE_STATE_LABELS.scheduled, tone: 'neutral', icon: 'clock' };
    case 'unrecorded':
      return { label: OCCURRENCE_STATE_LABELS.unrecorded, tone: 'attention', icon: 'circle-dashed' };
    case 'taken':
      return { label: OCCURRENCE_STATE_LABELS.taken, tone: 'done', icon: 'check' };
    case 'not_taken':
      return { label: OCCURRENCE_STATE_LABELS.not_taken, tone: 'skipped', icon: 'x' };
  }
}

/**
 * Effective state on the client: the server state, but a "scheduled" occurrence whose
 * time has been reached is shown as "Não registrado" (still no decision).
 */
export function effectiveState(o: Pick<Occurrence, 'state' | 'scheduledAt' | 'intake'>, now: Date = new Date()): OccurrenceState {
  if (o.intake) return o.intake.status === 'taken' ? 'taken' : 'not_taken';
  if (o.state === 'taken' || o.state === 'not_taken') return o.state;
  return new Date(o.scheduledAt).getTime() <= now.getTime() ? 'unrecorded' : 'scheduled';
}

export function isDecided(state: OccurrenceState) {
  return state === 'taken' || state === 'not_taken';
}

export function formatDose(dose: string, unit: string) {
  return `${dose.replace('.', ',')} ${unit}`;
}
