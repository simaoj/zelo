import type { DispatchDueReminders, PlanReminders } from '../../../application/use-cases/reminders.js';

export const REMINDER_TICK_MS = 60_000;

/**
 * Worker loop (run by the worker entrypoint, any number of instances): every ~60s plan jobs for
 * upcoming occurrences, then drain due jobs. Overlapping ticks in one process are skipped; across
 * processes, job leases + the unique (occurrenceId, subscriptionId) key prevent duplicates.
 */
export function reminderWorker(deps: {
  plan: PlanReminders;
  dispatch: DispatchDueReminders;
  enabled: () => boolean;
  intervalMs?: number;
  log?: (msg: string) => void;
}) {
  const log = deps.log ?? ((m: string) => console.error(`[notifications.reminders] ${m}`));
  let running = false;
  async function tick(): Promise<void> {
    if (running || !deps.enabled()) return;
    running = true;
    try {
      await deps.plan.execute();
      await deps.dispatch.execute();
    } catch (err) {
      log(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  }
  return {
    name: 'notifications.reminders',
    tick,
    start: async () => {
      void tick();
      const timer = setInterval(() => void tick(), deps.intervalMs ?? REMINDER_TICK_MS);
      return async () => clearInterval(timer);
    },
  };
}
