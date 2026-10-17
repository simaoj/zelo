import type { UnitOfWork } from '../../../../../shared/application/ports.js';
import type { RoutineRepository } from '../../../application/ports/out/repositories.js';
import type { GenerateOccurrences } from '../../../application/use-cases/generate-occurrences.js';

export const HORIZON_INTERVAL_MS = 60 * 60_000;

/**
 * Keeps the rolling window (today−7…today+14, schedule tz) materialized for every user with an
 * open schedule, so reminders can be planned even when the user doesn't open the app.
 * Idempotent (unique slot key), so running it on several workers at once is harmless.
 */
export function occurrenceHorizonJob(deps: {
  routines: RoutineRepository;
  generate: GenerateOccurrences;
  uow: UnitOfWork;
  intervalMs?: number;
  log?: (msg: string, err?: unknown) => void;
}) {
  const log = deps.log ?? ((m: string, e?: unknown) => console.error(`[routine.occurrence-horizon] ${m}`, e ?? ''));
  let running = false;
  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const userId of await deps.routines.listUsersWithOpenVersions()) {
        try {
          await deps.uow.run((tx) => deps.generate.windowForUser(userId, tx));
        } catch (err) {
          log('generation failed for a user', err instanceof Error ? err.message : err);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    name: 'routine.occurrence-horizon',
    tick,
    start: async () => {
      void tick();
      const timer = setInterval(() => void tick(), deps.intervalMs ?? HORIZON_INTERVAL_MS);
      return async () => clearInterval(timer);
    },
  };
}
