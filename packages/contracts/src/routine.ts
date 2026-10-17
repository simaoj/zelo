import { z } from 'zod';
import {
  DoseAmount,
  Id,
  Instant,
  LocalDate,
  LocalTime,
  MutationMeta,
  Name,
  Notes,
  ResourceMeta,
  TimeZone,
  VersionedMutationMeta,
} from './common.js';

export const ROUTINE_TYPES = ['medication', 'vitamin', 'supplement'] as const;
export const RoutineType = z.enum(ROUTINE_TYPES);
export type RoutineType = z.infer<typeof RoutineType>;
export const ROUTINE_TYPE_LABELS: Record<RoutineType, string> = {
  medication: 'Medicamento',
  vitamin: 'Vitamina',
  supplement: 'Suplemento',
};

export const FREQUENCIES = ['daily', 'weekly', 'none'] as const;
export const Frequency = z.enum(FREQUENCIES);
export type Frequency = z.infer<typeof Frequency>;

/** 0 = Sunday ... 6 = Saturday */
export const Weekday = z.number().int().min(0).max(6);

export const ScheduleInput = z
  .object({
    frequency: Frequency,
    weekdays: z.array(Weekday).default([]),
    times: z.array(LocalTime).default([]),
    timezone: TimeZone,
    startDate: LocalDate,
    /** inclusive */
    endDate: LocalDate.nullable(),
    reminderEnabled: z.boolean(),
  })
  .superRefine((s, ctx) => {
    if (s.frequency !== 'none' && s.times.length === 0)
      ctx.addIssue({ code: 'custom', path: ['times'], message: 'Informe ao menos um horário' });
    if (new Set(s.times).size !== s.times.length)
      ctx.addIssue({ code: 'custom', path: ['times'], message: 'Horários repetidos' });
    if (s.frequency === 'weekly' && s.weekdays.length === 0)
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Escolha ao menos um dia' });
    if (s.endDate && s.endDate < s.startDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'O término não pode ser anterior ao início' });
  });
export type ScheduleInput = z.infer<typeof ScheduleInput>;

export const ScheduleVersion = z.object({
  id: Id,
  itemId: Id,
  frequency: Frequency,
  weekdays: z.array(Weekday),
  times: z.array(LocalTime),
  timezone: TimeZone,
  startDate: LocalDate,
  endDate: LocalDate.nullable(),
  effectiveFrom: Instant,
  effectiveUntil: Instant.nullable(),
  doseSnapshot: DoseAmount,
  unitSnapshot: z.string(),
  reminderEnabled: z.boolean(),
});
export type ScheduleVersion = z.infer<typeof ScheduleVersion>;

export const RoutineItem = ResourceMeta.extend({
  name: z.string(),
  type: RoutineType,
  currentDose: DoseAmount,
  currentUnit: z.string(),
  instructions: Notes,
  archivedAt: Instant.nullable(),
  /** The currently effective schedule version (null only if none was ever created). */
  currentSchedule: ScheduleVersion.nullable(),
});
export type RoutineItem = z.infer<typeof RoutineItem>;

export const CreateRoutineItemRequest = MutationMeta.extend({
  id: Id,
  name: Name,
  type: RoutineType,
  dose: DoseAmount,
  unit: z.string().trim().min(1, 'Unidade obrigatória').max(30),
  instructions: Notes.optional(),
  schedule: ScheduleInput,
});
export type CreateRoutineItemRequest = z.infer<typeof CreateRoutineItemRequest>;

/** Edits name/instructions only. Dose/unit/schedule changes go through POST /schedules (versioned). */
export const UpdateRoutineItemRequest = VersionedMutationMeta.extend({
  name: Name.optional(),
  type: RoutineType.optional(),
  instructions: Notes.optional(),
});
export type UpdateRoutineItemRequest = z.infer<typeof UpdateRoutineItemRequest>;

/** Creates a new schedule version effective now; may change dose/unit too. */
export const ReviseScheduleRequest = VersionedMutationMeta.extend({
  dose: DoseAmount,
  unit: z.string().trim().min(1).max(30),
  schedule: ScheduleInput,
});
export type ReviseScheduleRequest = z.infer<typeof ReviseScheduleRequest>;

export const ArchiveRoutineItemRequest = VersionedMutationMeta;

export const RoutineItemList = z.object({ items: z.array(RoutineItem) });

// ---------- Occurrences & intakes ----------

export const INTAKE_STATUSES = ['taken', 'not_taken'] as const;
export const IntakeStatus = z.enum(INTAKE_STATUSES);
export type IntakeStatus = z.infer<typeof IntakeStatus>;

/**
 * Derived display state:
 *  scheduled  – future, no decision
 *  unrecorded – time reached, no decision (NEVER auto-converted to not_taken)
 *  taken / not_taken – explicit user decision
 */
export const OCCURRENCE_STATES = ['scheduled', 'unrecorded', 'taken', 'not_taken'] as const;
export const OccurrenceState = z.enum(OCCURRENCE_STATES);
export type OccurrenceState = z.infer<typeof OccurrenceState>;
export const OCCURRENCE_STATE_LABELS: Record<OccurrenceState, string> = {
  scheduled: 'Programado',
  unrecorded: 'Não registrado',
  taken: 'Tomado',
  not_taken: 'Não tomado',
};

export const IntakeRecord = ResourceMeta.extend({
  itemId: Id,
  occurrenceId: Id.nullable(),
  status: IntakeStatus,
  /** required when status = taken; never in the future */
  actualTakenAt: Instant.nullable(),
  notes: Notes,
  nameSnapshot: z.string(),
  doseSnapshot: DoseAmount,
  unitSnapshot: z.string(),
});
export type IntakeRecord = z.infer<typeof IntakeRecord>;

export const Occurrence = z.object({
  id: Id,
  itemId: Id,
  scheduleVersionId: Id,
  scheduledAt: Instant,
  localDate: LocalDate,
  localTime: LocalTime,
  nameSnapshot: z.string(),
  doseSnapshot: DoseAmount,
  unitSnapshot: z.string(),
  itemType: RoutineType,
  state: OccurrenceState,
  intake: IntakeRecord.nullable(),
});
export type Occurrence = z.infer<typeof Occurrence>;

export const OccurrenceList = z.object({ date: LocalDate, items: z.array(Occurrence) });
export type OccurrenceList = z.infer<typeof OccurrenceList>;

/** PUT /occurrences/:id/intake — create or replace the decision for an occurrence. */
export const PutOccurrenceIntakeRequest = MutationMeta.extend({
  /** client id used if a new intake record is created */
  intakeId: Id,
  status: IntakeStatus,
  actualTakenAt: Instant.nullable(),
  notes: Notes.optional(),
  /** required when replacing an existing decision */
  expectedVersion: z.number().int().nonnegative().optional(),
});
export type PutOccurrenceIntakeRequest = z.infer<typeof PutOccurrenceIntakeRequest>;

/** POST /intakes — ad-hoc intake for a registered item, not linked to an occurrence. */
export const CreateIntakeRequest = MutationMeta.extend({
  id: Id,
  itemId: Id,
  actualTakenAt: Instant,
  notes: Notes.optional(),
});
export type CreateIntakeRequest = z.infer<typeof CreateIntakeRequest>;

export const UpdateIntakeRequest = VersionedMutationMeta.extend({
  actualTakenAt: Instant.optional(),
  notes: Notes.optional(),
});
export type UpdateIntakeRequest = z.infer<typeof UpdateIntakeRequest>;

export const IntakePage = z.object({ items: z.array(IntakeRecord), nextCursor: z.string().nullable() });
