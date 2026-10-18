import type { HealthImportResponse, ImportCounters } from '@zelo/contracts';
import type { ChangeLog, Clock, IdGenerator, UnitOfWork } from '../../../../shared/application/ports.js';
import { HEALTH_AUTO_EXPORT, assertStepsValues, assertWorkoutValues, sameSteps, sameWorkout, type StepsValues, type WorkoutValues } from '../../domain/activity.js';
import { ConcurrentUpsertError, type DailyStepsRepository, type WorkoutRepository } from '../ports/out/index.js';

/** Already-parsed, fully validated batch (built by the HTTP adapter from the external JSON). */
export interface HealthExportCommand {
  steps: StepsValues[];
  workouts: WorkoutValues[];
}

const zero = (): ImportCounters => ({ inserted: 0, updated: 0, unchanged: 0 });

/**
 * ReceiveHealthExport — persists one received batch for the authenticated user.
 *
 * - The whole batch was validated before this runs; all writes happen in ONE transaction, so a
 *   DB failure leaves nothing half-written (the caller answers 500 and the sender may resend).
 * - Upserts by natural key ("último recebimento substitui"): steps by (user, provider, localDate),
 *   workouts by (user, provider, externalId). `$set`, never `$inc`; absent days/workouts are kept.
 * - Counters are real: inserted (no previous doc), updated (some value differs), unchanged (equal
 *   values; only `receivedAt` is refreshed and no sync change is emitted).
 * - Two concurrent identical batches: the transaction conflict is retried by the UnitOfWork; if a
 *   racing insert still surfaces as a duplicate key, the whole batch is retried once.
 */
export class ReceiveHealthExport {
  constructor(
    private readonly d: {
      steps: DailyStepsRepository;
      workouts: WorkoutRepository;
      uow: UnitOfWork;
      changeLog: ChangeLog;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  async execute(userId: string, cmd: HealthExportCommand): Promise<HealthImportResponse> {
    cmd.steps.forEach(assertStepsValues);
    cmd.workouts.forEach(assertWorkoutValues);
    try {
      return await this.run(userId, cmd);
    } catch (err) {
      if (!(err instanceof ConcurrentUpsertError)) throw err;
      return this.run(userId, cmd); // the racing insert is now visible → update/unchanged
    }
  }

  private run(userId: string, cmd: HealthExportCommand): Promise<HealthImportResponse> {
    return this.d.uow.run(async (tx) => {
      const steps = zero();
      const workouts = zero();
      const receivedAt = this.d.clock.now();
      for (const v of cmd.steps) {
        const r = await this.d.steps.upsert(userId, HEALTH_AUTO_EXPORT, v, receivedAt, this.d.ids.next(), tx);
        if (r.before && sameSteps(r.before, v)) {
          steps.unchanged += 1;
          continue;
        }
        if (r.before) steps.updated += 1;
        else steps.inserted += 1;
        await this.d.changeLog.record(tx, userId, { entity: 'dailySteps', id: r.id, op: 'upsert' });
      }
      for (const v of cmd.workouts) {
        const r = await this.d.workouts.upsert(userId, HEALTH_AUTO_EXPORT, v, receivedAt, this.d.ids.next(), tx);
        if (r.before && sameWorkout(r.before, v)) {
          workouts.unchanged += 1;
          continue;
        }
        if (r.before) workouts.updated += 1;
        else workouts.inserted += 1;
        await this.d.changeLog.record(tx, userId, { entity: 'workout', id: r.id, op: 'upsert' });
      }
      return { status: 'ok' as const, steps, workouts };
    });
  }
}
