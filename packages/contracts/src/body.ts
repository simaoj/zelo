import { z } from 'zod';
import {
  Id,
  Instant,
  LengthCm,
  MutationMeta,
  Notes,
  ResourceMeta,
  TimeZone,
  VersionedMutationMeta,
  WeightKg,
  page,
} from './common.js';

// ---------- Weight ----------

export const WeightEntry = ResourceMeta.extend({
  measuredAt: Instant,
  timezone: TimeZone,
  weightKg: WeightKg,
  notes: Notes,
  /** weightKg minus the chronologically previous entry; null if none. Decimal string, may be negative. */
  deltaKg: z.string().nullable(),
});
export type WeightEntry = z.infer<typeof WeightEntry>;

export const CreateWeightRequest = MutationMeta.extend({
  /** client-generated id (allows offline creation) */
  id: Id,
  measuredAt: Instant,
  timezone: TimeZone,
  weightKg: WeightKg,
  notes: Notes.optional(),
});
export type CreateWeightRequest = z.infer<typeof CreateWeightRequest>;

export const UpdateWeightRequest = VersionedMutationMeta.extend({
  measuredAt: Instant.optional(),
  timezone: TimeZone.optional(),
  weightKg: WeightKg.optional(),
  notes: Notes.optional(),
});
export type UpdateWeightRequest = z.infer<typeof UpdateWeightRequest>;

export const WeightPage = page(WeightEntry);
export type WeightPage = z.infer<typeof WeightPage>;

export const WeightGoal = z.object({
  targetKg: WeightKg,
  version: z.number().int(),
  updatedAt: Instant,
});
export type WeightGoal = z.infer<typeof WeightGoal>;

export const PutWeightGoalRequest = MutationMeta.extend({ targetKg: WeightKg });
export type PutWeightGoalRequest = z.infer<typeof PutWeightGoalRequest>;

// ---------- Measurements ----------

export const MEASUREMENT_TYPES = ['waist', 'abdomen', 'hip', 'chest', 'arm', 'thigh'] as const;
export const MeasurementType = z.enum(MEASUREMENT_TYPES);
export type MeasurementType = z.infer<typeof MeasurementType>;

export const SIDES = ['left', 'right', 'unspecified'] as const;
export const Side = z.enum(SIDES);
export type Side = z.infer<typeof Side>;

/** Only arm and thigh may have left/right. */
export const SIDED_TYPES: readonly MeasurementType[] = ['arm', 'thigh'];

export const MEASUREMENT_LABELS: Record<MeasurementType, string> = {
  waist: 'Cintura',
  abdomen: 'Abdômen',
  hip: 'Quadril',
  chest: 'Peito',
  arm: 'Braço',
  thigh: 'Coxa',
};
export const SIDE_LABELS: Record<Side, string> = { left: 'esquerdo', right: 'direito', unspecified: 'não especificado' };

export const MeasurementValue = z.object({ type: MeasurementType, side: Side, valueCm: LengthCm });
export type MeasurementValue = z.infer<typeof MeasurementValue>;

const valuesSchema = z
  .array(MeasurementValue)
  .min(1, 'Informe pelo menos uma medida')
  .superRefine((values, ctx) => {
    const seen = new Set<string>();
    values.forEach((v, i) => {
      if (!SIDED_TYPES.includes(v.type) && v.side !== 'unspecified') {
        ctx.addIssue({ code: 'custom', path: [i, 'side'], message: 'Este tipo não tem lado' });
      }
      const key = `${v.type}:${v.side}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i], message: 'Medida repetida' });
      seen.add(key);
    });
  });

export const MeasurementSession = ResourceMeta.extend({
  measuredAt: Instant,
  timezone: TimeZone,
  notes: Notes,
  values: z.array(MeasurementValue),
});
export type MeasurementSession = z.infer<typeof MeasurementSession>;

export const CreateMeasurementRequest = MutationMeta.extend({
  id: Id,
  measuredAt: Instant,
  timezone: TimeZone,
  notes: Notes.optional(),
  values: valuesSchema,
});
export type CreateMeasurementRequest = z.infer<typeof CreateMeasurementRequest>;

export const UpdateMeasurementRequest = VersionedMutationMeta.extend({
  measuredAt: Instant.optional(),
  timezone: TimeZone.optional(),
  notes: Notes.optional(),
  values: valuesSchema.optional(),
});
export type UpdateMeasurementRequest = z.infer<typeof UpdateMeasurementRequest>;

export const MeasurementPage = page(MeasurementSession);
export type MeasurementPage = z.infer<typeof MeasurementPage>;

// ---------- Blood pressure ----------

export const BloodPressureEntry = ResourceMeta.extend({
  measuredAt: Instant,
  timezone: TimeZone,
  systolic: z.number().int().positive(),
  diastolic: z.number().int().positive(),
  pulseBpm: z.number().int().positive().nullable(),
  notes: Notes,
});
export type BloodPressureEntry = z.infer<typeof BloodPressureEntry>;

const bpFields = {
  systolic: z.number().int().positive(),
  diastolic: z.number().int().positive(),
  pulseBpm: z.number().int().positive().nullable(),
  /**
   * Must be true when diastolic >= systolic; otherwise the server answers
   * 422 CONFIRMATION_REQUIRED so the UI can ask the user to double-check.
   */
  confirmedUnusual: z.boolean().optional(),
};

export const CreateBloodPressureRequest = MutationMeta.extend({
  id: Id,
  measuredAt: Instant,
  timezone: TimeZone,
  notes: Notes.optional(),
  ...bpFields,
});
export type CreateBloodPressureRequest = z.infer<typeof CreateBloodPressureRequest>;

export const UpdateBloodPressureRequest = VersionedMutationMeta.extend({
  measuredAt: Instant.optional(),
  timezone: TimeZone.optional(),
  notes: Notes.optional(),
  systolic: bpFields.systolic.optional(),
  diastolic: bpFields.diastolic.optional(),
  pulseBpm: bpFields.pulseBpm.optional(),
  confirmedUnusual: bpFields.confirmedUnusual,
});
export type UpdateBloodPressureRequest = z.infer<typeof UpdateBloodPressureRequest>;

export const BloodPressurePage = page(BloodPressureEntry);
export type BloodPressurePage = z.infer<typeof BloodPressurePage>;
