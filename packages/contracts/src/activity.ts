import { z } from 'zod';
import { Id, Instant, LocalDate, MutationMeta } from './common.js';

/**
 * Activity data is READ-ONLY in Zelo: it is received from the Health Auto Export iPhone app
 * via POST /imports/health (token auth). Zelo never pulls, schedules or syncs with the iPhone.
 */
export const ACTIVITY_PROVIDERS = ['health-auto-export'] as const;
export const ActivityProvider = z.enum(ACTIVITY_PROVIDERS);
export type ActivityProvider = z.infer<typeof ActivityProvider>;

export const DailySteps = z.object({
  id: Id,
  provider: ActivityProvider,
  /** local date as given by the export (its own offset), not re-derived */
  localDate: LocalDate,
  /** consolidated daily total; 0 is a real reported zero */
  count: z.number().int().nonnegative(),
  /** UTC offset (minutes) of the exported timestamp */
  offsetMinutes: z.number().int(),
  /** when Zelo last received this total */
  receivedAt: Instant,
  createdAt: Instant,
});
export type DailySteps = z.infer<typeof DailySteps>;

export const Workout = z.object({
  id: Id,
  provider: ActivityProvider,
  /** activity name as exported, e.g. "Running", "Walking" */
  name: z.string(),
  startedAt: Instant,
  endedAt: Instant,
  /** UTC offset (minutes) of the exported start timestamp */
  startOffsetMinutes: z.number().int(),
  /** local date of the start, from the export's offset */
  localDate: LocalDate,
  /** as exported (may exclude pauses) — never recomputed from start/end */
  durationSeconds: z.number().nonnegative(),
  distanceMeters: z.number().nonnegative().nullable(),
  /** activeEnergyBurned converted to kcal (NOT totalEnergy) */
  activeEnergyKcal: z.number().nonnegative().nullable(),
  receivedAt: Instant,
  createdAt: Instant,
});
export type Workout = z.infer<typeof Workout>;

export const ActivityGoal = z.object({
  dailyStepsTarget: z.number().int().positive(),
  version: z.number().int(),
  updatedAt: Instant,
});
export type ActivityGoal = z.infer<typeof ActivityGoal>;

export const PutActivityGoalRequest = MutationMeta.extend({
  dailyStepsTarget: z.number().int().positive().max(200000),
});
export type PutActivityGoalRequest = z.infer<typeof PutActivityGoalRequest>;

/** GET /activity/steps?from&to (inclusive local dates, max 400 days) */
export const StepsQuery = z.object({ from: LocalDate, to: LocalDate });
export type StepsQuery = z.infer<typeof StepsQuery>;

export const StepsDay = z.object({
  date: LocalDate,
  /** null = no data received for this day ("sem dados"); 0 = reported zero */
  count: z.number().int().nonnegative().nullable(),
  /** true when date is "today" in the profile tz — total may still grow */
  partial: z.boolean(),
  receivedAt: Instant.nullable(),
});
export type StepsDay = z.infer<typeof StepsDay>;

export const StepsSummary = z.object({
  from: LocalDate,
  to: LocalDate,
  days: z.array(StepsDay),
  goal: ActivityGoal.nullable(),
  /** average over days WITH data only; null if none */
  averageOnDaysWithData: z.number().int().nullable(),
  /** latest receivedAt across all steps & workouts of the user */
  lastReceivedAt: Instant.nullable(),
});
export type StepsSummary = z.infer<typeof StepsSummary>;

/** GET /activity/workouts?from&to&name&cursor&limit — ordered by startedAt desc */
export const WorkoutsQuery = z.object({
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  /** exact activity name filter */
  name: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type WorkoutsQuery = z.infer<typeof WorkoutsQuery>;

export const WorkoutPage = z.object({
  items: z.array(Workout),
  nextCursor: z.string().nullable(),
  /** distinct activity names of the user (for the filter) */
  availableNames: z.array(z.string()),
});
export type WorkoutPage = z.infer<typeof WorkoutPage>;

/** Compact activity block for /dashboard and the Atividade → Resumo tab. */
export const ActivityToday = z.object({
  date: LocalDate,
  steps: StepsDay,
  stepsGoal: ActivityGoal.nullable(),
  workoutCount: z.number().int().nonnegative(),
  workoutSeconds: z.number().nonnegative(),
  lastReceivedAt: Instant.nullable(),
});
export type ActivityToday = z.infer<typeof ActivityToday>;

// ---------- Import (Health Auto Export → Zelo) ----------

export const ImportCounters = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type ImportCounters = z.infer<typeof ImportCounters>;

/** 200 body of POST /imports/health */
export const HealthImportResponse = z.object({
  status: z.literal('ok'),
  steps: ImportCounters,
  workouts: ImportCounters,
});
export type HealthImportResponse = z.infer<typeof HealthImportResponse>;

/** Max accepted body for POST /imports/health (bytes). */
export const HEALTH_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
