/** Maps domain entities to transport (contract) shapes. Type-only dependency on @zelo/contracts. */
import type {
  IntakeRecord as IntakeDto,
  Occurrence as OccurrenceDto,
  RoutineItem as RoutineItemDto,
  ScheduleVersion as ScheduleVersionDto,
} from '@zelo/contracts';
import type { RoutineItem } from '../domain/entities/routine-item.js';
import type { ScheduleVersion } from '../domain/entities/schedule-version.js';
import type { Occurrence } from '../domain/entities/occurrence.js';
import { deriveState } from '../domain/entities/occurrence.js';
import type { IntakeRecord } from '../domain/entities/intake-record.js';

const iso = (d: Date) => d.toISOString();

export function toScheduleDto(v: ScheduleVersion): ScheduleVersionDto {
  return {
    id: v.id,
    itemId: v.itemId,
    frequency: v.frequency,
    weekdays: v.weekdays,
    times: v.times,
    timezone: v.timezone,
    startDate: v.startDate,
    endDate: v.endDate,
    effectiveFrom: iso(v.effectiveFrom),
    effectiveUntil: v.effectiveUntil ? iso(v.effectiveUntil) : null,
    doseSnapshot: v.doseSnapshot,
    unitSnapshot: v.unitSnapshot,
    reminderEnabled: v.reminderEnabled,
  };
}

export function toItemDto(item: RoutineItem, schedule: ScheduleVersion | null): RoutineItemDto {
  return {
    id: item.id,
    version: item.version,
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
    name: item.name,
    type: item.type,
    currentDose: item.currentDose,
    currentUnit: item.currentUnit,
    instructions: item.instructions,
    archivedAt: item.archivedAt ? iso(item.archivedAt) : null,
    currentSchedule: schedule ? toScheduleDto(schedule) : null,
  };
}

export function toIntakeDto(r: IntakeRecord): IntakeDto {
  return {
    sortAt: iso(r.sortAt),
    id: r.id,
    version: r.version,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    itemId: r.itemId,
    occurrenceId: r.occurrenceId,
    status: r.status,
    actualTakenAt: r.actualTakenAt ? iso(r.actualTakenAt) : null,
    notes: r.notes,
    nameSnapshot: r.nameSnapshot,
    doseSnapshot: r.doseSnapshot,
    unitSnapshot: r.unitSnapshot,
  };
}

export function toOccurrenceDto(o: Occurrence, liveIntake: IntakeRecord | null, now: Date): OccurrenceDto {
  return {
    id: o.id,
    itemId: o.itemId,
    scheduleVersionId: o.scheduleVersionId,
    scheduledAt: iso(o.scheduledAt),
    localDate: o.localDate,
    localTime: o.localTime,
    nameSnapshot: o.nameSnapshot,
    doseSnapshot: o.doseSnapshot,
    unitSnapshot: o.unitSnapshot,
    itemType: o.itemType,
    state: deriveState(o, liveIntake, now),
    intake: liveIntake ? toIntakeDto(liveIntake) : null,
  };
}
