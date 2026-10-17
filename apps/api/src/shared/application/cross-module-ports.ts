/**
 * Ports one module exposes to another (implemented by the owning module, injected by bootstrap).
 * Return contract (transport) shapes from @zelo/contracts so consumers don't touch internals.
 */
import type { BloodPressureEntry, MeasurementSession, WeightEntry } from '@zelo/contracts';

/** Implemented by `profile` module (backend-core). Used by routine/dashboard/notifications. */
export interface ProfileReader {
  /** IANA timezone of the user's profile, e.g. "America/Sao_Paulo" */
  getTimezone(userId: string): Promise<string>;
  getDisplayName(userId: string): Promise<string>;
  remindersEnabled(userId: string): Promise<boolean>;
}

/** Implemented by `body` + `blood-pressure` modules (backend-core). Used by dashboard (backend-routine). */
export interface HealthSnapshotReader {
  latestWeight(userId: string): Promise<WeightEntry | null>;
  /** up to `limit` most recent weights, returned ascending by measuredAt */
  recentWeights(userId: string, limit: number): Promise<{ measuredAt: string; weightKg: string }[]>;
  latestBloodPressure(userId: string): Promise<BloodPressureEntry | null>;
  latestMeasurement(userId: string): Promise<MeasurementSession | null>;
}

/** Implemented by `notifications` module (backend-routine). Used by identity on logout / account deletion. */
export interface PushSubscriptionRevoker {
  revokeForDevice(userId: string, deviceId: string): Promise<void>;
}
