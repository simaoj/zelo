import { z } from 'zod';
import { Instant, LocalDate, MutationMeta, Notes, ResourceMeta, TimeZone, VersionedMutationMeta, Id, page } from './common.js';

/** Water amount in ml: positive integer. Upper bound is a typo guard, not a clinical limit. */
export const WaterMl = z.number().int('Use um número inteiro de ml').positive('A quantidade deve ser positiva').max(10000);

export const QUICK_WATER_AMOUNTS_ML = [200, 300, 500] as const;

export const WaterEntry = ResourceMeta.extend({
  consumedAt: Instant,
  /** IANA tz of the device when registered (informational; daily grouping uses the PROFILE tz) */
  timezone: TimeZone,
  amountMl: WaterMl,
  notes: Notes,
});
export type WaterEntry = z.infer<typeof WaterEntry>;

export const CreateWaterEntryRequest = MutationMeta.extend({
  /** client-generated id (offline creation) */
  id: Id,
  consumedAt: Instant,
  timezone: TimeZone,
  amountMl: WaterMl,
  notes: Notes.optional(),
});
export type CreateWaterEntryRequest = z.infer<typeof CreateWaterEntryRequest>;

export const UpdateWaterEntryRequest = VersionedMutationMeta.extend({
  consumedAt: Instant.optional(),
  timezone: TimeZone.optional(),
  amountMl: WaterMl.optional(),
  notes: Notes.optional(),
});
export type UpdateWaterEntryRequest = z.infer<typeof UpdateWaterEntryRequest>;

export const WaterEntryPage = page(WaterEntry);
export type WaterEntryPage = z.infer<typeof WaterEntryPage>;

export const HydrationGoal = z.object({
  dailyTargetMl: WaterMl,
  version: z.number().int(),
  updatedAt: Instant,
});
export type HydrationGoal = z.infer<typeof HydrationGoal>;

export const PutHydrationGoalRequest = MutationMeta.extend({ dailyTargetMl: WaterMl });
export type PutHydrationGoalRequest = z.infer<typeof PutHydrationGoalRequest>;

/** GET /hydration/summary?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive, local dates in the PROFILE tz, max 400 days) */
export const HydrationSummaryQuery = z.object({ from: LocalDate, to: LocalDate });
export type HydrationSummaryQuery = z.infer<typeof HydrationSummaryQuery>;

/**
 * One row per local date in [from, to]. `totalMl` is null when the day has NO records
 * ("sem registros") — never 0 for absence. Entries are positive, so a day with records
 * always has totalMl > 0; the UI must not render absent days as zero consumption.
 */
export const HydrationDay = z.object({
  date: LocalDate,
  totalMl: z.number().int().nonnegative().nullable(),
  entryCount: z.number().int().nonnegative(),
});
export type HydrationDay = z.infer<typeof HydrationDay>;

export const HydrationSummary = z.object({
  timezone: TimeZone,
  from: LocalDate,
  to: LocalDate,
  days: z.array(HydrationDay),
  goal: HydrationGoal.nullable(),
  /** average over days WITH records only; null if none */
  averageMlOnRecordedDays: z.number().int().nullable(),
});
export type HydrationSummary = z.infer<typeof HydrationSummary>;
