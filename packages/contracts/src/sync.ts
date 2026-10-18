import { z } from 'zod';
import { ApiError, DeleteRequest, Id, Instant, LocalDate } from './common.js';
import {
  BloodPressureEntry,
  CreateBloodPressureRequest,
  CreateMeasurementRequest,
  CreateWeightRequest,
  MeasurementSession,
  UpdateBloodPressureRequest,
  UpdateMeasurementRequest,
  UpdateWeightRequest,
  WeightEntry,
  WeightGoal,
} from './body.js';
import { Profile } from './identity.js';
import {
  CreateIntakeRequest,
  IntakeRecord,
  Occurrence,
  PutOccurrenceIntakeRequest,
  RoutineItem,
} from './routine.js';
import { CreateWaterEntryRequest, HydrationGoal, UpdateWaterEntryRequest, WaterEntry } from './hydration.js';
import { ActivityGoal, ActivityToday, DailySteps, Workout } from './activity.js';

// ---------- Dashboard ----------

export const DashboardResponse = z.object({
  /** local date in the profile timezone that the dashboard refers to */
  date: LocalDate,
  timezone: z.string(),
  displayName: z.string(),
  latestWeight: WeightEntry.nullable(),
  /** last up-to-30 weights (ascending by measuredAt) for the sparkline */
  weightSparkline: z.array(z.object({ measuredAt: Instant, weightKg: z.string() })),
  latestBloodPressure: BloodPressureEntry.nullable(),
  latestMeasurement: MeasurementSession.nullable(),
  /** occurrences of `date`, ordered by scheduledAt */
  occurrences: z.array(Occurrence),
  /** water of `date` in the profile tz; totalMl null = no records that day */
  hydration: z.object({
    totalMl: z.number().int().nonnegative().nullable(),
    entryCount: z.number().int().nonnegative(),
    goal: HydrationGoal.nullable(),
    lastEntryAt: Instant.nullable(),
  }),
  /** received (read-only) activity data for `date` */
  activity: ActivityToday,
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;

// ---------- Sync ----------

/**
 * Entities replicated to the device. The server keeps a per-user monotonically
 * increasing sequence (`changeSeq`), bumped transactionally with every mutation.
 * The cursor is opaque to the client (base64 of the seq).
 */
export const SYNC_ENTITIES = [
  'profile',
  'weightEntry',
  'weightGoal',
  'measurementSession',
  'bloodPressureEntry',
  'routineItem',
  'occurrence',
  'intakeRecord',
  'waterEntry',
  'hydrationGoal',
  'dailySteps',
  'activityGoal',
  'workout',
] as const;
export const SyncEntity = z.enum(SYNC_ENTITIES);
export type SyncEntity = z.infer<typeof SyncEntity>;

export const SyncChange = z.discriminatedUnion('op', [
  z.object({ op: z.literal('upsert'), entity: SyncEntity, id: z.string(), data: z.unknown() }),
  /** tombstone */
  z.object({ op: z.literal('delete'), entity: SyncEntity, id: z.string() }),
]);
export type SyncChange = z.infer<typeof SyncChange>;

export const SyncBootstrapResponse = z.object({
  cursor: z.string(),
  profile: Profile,
  weightEntries: z.array(WeightEntry),
  weightGoal: WeightGoal.nullable(),
  measurementSessions: z.array(MeasurementSession),
  bloodPressureEntries: z.array(BloodPressureEntry),
  routineItems: z.array(RoutineItem),
  /** occurrences from 7 days ago until 7 days ahead (profile tz) */
  occurrences: z.array(Occurrence),
  intakeRecords: z.array(IntakeRecord),
  /** water entries of the last 90 days (profile tz) */
  waterEntries: z.array(WaterEntry),
  hydrationGoal: HydrationGoal.nullable(),
  /** received daily steps of the last 90 days (read-only) */
  dailySteps: z.array(DailySteps),
  activityGoal: ActivityGoal.nullable(),
  /** received workouts of the last 90 days (read-only) */
  workouts: z.array(Workout),
});
export type SyncBootstrapResponse = z.infer<typeof SyncBootstrapResponse>;

export const SyncChangesResponse = z.object({
  changes: z.array(SyncChange),
  cursor: z.string(),
  hasMore: z.boolean(),
});
export type SyncChangesResponse = z.infer<typeof SyncChangesResponse>;

/** Operation types the device may queue offline (spec §9: only measurements and intakes). */
export const SyncOperation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('weight.create'), entityId: Id, payload: CreateWeightRequest }),
  z.object({ type: z.literal('weight.update'), entityId: Id, payload: UpdateWeightRequest }),
  z.object({ type: z.literal('weight.delete'), entityId: Id, payload: DeleteRequest }),
  z.object({ type: z.literal('measurement.create'), entityId: Id, payload: CreateMeasurementRequest }),
  z.object({ type: z.literal('measurement.update'), entityId: Id, payload: UpdateMeasurementRequest }),
  z.object({ type: z.literal('measurement.delete'), entityId: Id, payload: DeleteRequest }),
  z.object({ type: z.literal('bloodPressure.create'), entityId: Id, payload: CreateBloodPressureRequest }),
  z.object({ type: z.literal('bloodPressure.update'), entityId: Id, payload: UpdateBloodPressureRequest }),
  z.object({ type: z.literal('bloodPressure.delete'), entityId: Id, payload: DeleteRequest }),
  /** entityId = occurrenceId */
  z.object({ type: z.literal('occurrence.intake.put'), entityId: Id, payload: PutOccurrenceIntakeRequest }),
  /** entityId = occurrenceId */
  z.object({ type: z.literal('occurrence.intake.delete'), entityId: Id, payload: DeleteRequest }),
  z.object({ type: z.literal('intake.create'), entityId: Id, payload: CreateIntakeRequest }),
  z.object({ type: z.literal('water.create'), entityId: Id, payload: CreateWaterEntryRequest }),
  z.object({ type: z.literal('water.update'), entityId: Id, payload: UpdateWaterEntryRequest }),
  z.object({ type: z.literal('water.delete'), entityId: Id, payload: DeleteRequest }),
]);
export type SyncOperation = z.infer<typeof SyncOperation>;
export type SyncOperationType = SyncOperation['type'];

export const SyncOperationsRequest = z.object({
  operations: z.array(SyncOperation).min(1).max(100),
});
export type SyncOperationsRequest = z.infer<typeof SyncOperationsRequest>;

export const SyncOperationResult = z.object({
  operationId: z.uuid(),
  /** HTTP-equivalent status of this operation */
  status: z.number().int(),
  /** success body (resource) */
  body: z.unknown().optional(),
  error: ApiError.optional(),
});
export type SyncOperationResult = z.infer<typeof SyncOperationResult>;

/**
 * Operations are processed in order. Processing stops at the first 401.
 * Results contain one entry per processed operation.
 */
export const SyncOperationsResponse = z.object({ results: z.array(SyncOperationResult) });
export type SyncOperationsResponse = z.infer<typeof SyncOperationsResponse>;

// ---------- Push ----------

export const PushSubscriptionRequest = z.object({
  deviceId: Id,
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequest>;

export const PushSubscriptionResponse = z.object({ id: Id, deviceId: Id, createdAt: Instant });
export type PushSubscriptionResponse = z.infer<typeof PushSubscriptionResponse>;

export const PushConfigResponse = z.object({ vapidPublicKey: z.string().nullable() });
export type PushConfigResponse = z.infer<typeof PushConfigResponse>;

/** Generic lock-screen text (spec §9). */
export const GENERIC_PUSH_TITLE = 'Zelo';
export const GENERIC_PUSH_BODY = 'Você tem um cuidado programado no Zelo';
