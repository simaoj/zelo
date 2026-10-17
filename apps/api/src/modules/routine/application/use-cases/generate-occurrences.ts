import type { TxContext } from '../../../../shared/application/ports.js';
import type { RoutineItem } from '../../domain/entities/routine-item.js';
import { planSlots, type ScheduleVersion } from '../../domain/entities/schedule-version.js';
import { addDays, localDateOf } from '../../domain/value-objects/local-time.js';
import { WINDOW_FUTURE_DAYS, WINDOW_PAST_DAYS, type RoutineAppDeps } from '../deps.js';
import type { NewOccurrence } from '../ports/out/repositories.js';

/**
 * GenerateOccurrences — materializes occurrences from schedule versions.
 *
 * Idempotent: slots are keyed by (scheduleVersionId, localDate, localTime) with a unique index,
 * and upserts only insert ($setOnInsert). Re-running never duplicates, never resurrects a
 * cancelled occurrence and never touches existing ones. Runs inside the caller's transaction;
 * every created occurrence is recorded in the change log for sync.
 *
 * Generation happens:
 *  - eagerly for the rolling window (today−7…today+14 in the SCHEDULE tz) when a version is created;
 *  - lazily for any instant range that is queried (GET /occurrences, dashboard, sync bootstrap);
 *  - periodically by the `routine.occurrence-horizon` job so reminders exist for users who don't open the app.
 */
export class GenerateOccurrences {
  constructor(private readonly d: RoutineAppDeps) {}

  /** Rolling window for the given versions. */
  async forWindow(userId: string, versions: ScheduleVersion[], tx: TxContext): Promise<number> {
    const now = this.d.clock.now();
    return this.generate(
      userId,
      versions,
      (v) => {
        const today = localDateOf(now, v.timezone);
        return [addDays(today, -WINDOW_PAST_DAYS), addDays(today, WINDOW_FUTURE_DAYS)];
      },
      null,
      tx,
    );
  }

  /** Everything any version can produce within the instant range [from, to). */
  async forRange(userId: string, from: Date, to: Date, tx: TxContext): Promise<number> {
    const versions = await this.d.routines.listGeneratableVersions(userId, from, to, tx);
    return this.generate(
      userId,
      versions,
      (v) => [localDateOf(from, v.timezone), localDateOf(new Date(to.getTime() - 1), v.timezone)],
      { from, to },
      tx,
    );
  }

  /** Rolling window for every open version of the user (background job). */
  async windowForUser(userId: string, tx: TxContext): Promise<number> {
    const now = this.d.clock.now();
    const versions = await this.d.routines.listGeneratableVersions(userId, now, new Date(now.getTime() + 1), tx);
    return this.forWindow(userId, versions.filter((v) => v.effectiveUntil === null), tx);
  }

  private async generate(
    userId: string,
    versions: ScheduleVersion[],
    datesFor: (v: ScheduleVersion) => [string, string],
    instantFilter: { from: Date; to: Date } | null,
    tx: TxContext,
  ): Promise<number> {
    if (versions.length === 0) return 0;
    const itemCache = new Map<string, RoutineItem | null>();
    const slots: NewOccurrence[] = [];
    for (const v of versions) {
      if (!itemCache.has(v.itemId)) itemCache.set(v.itemId, await this.d.routines.getItem(userId, v.itemId, tx));
      const item = itemCache.get(v.itemId);
      if (!item) continue;
      const [fromDate, toDate] = datesFor(v);
      for (const s of planSlots(v, fromDate, toDate)) {
        if (instantFilter && (s.scheduledAt < instantFilter.from || s.scheduledAt >= instantFilter.to)) continue;
        slots.push({
          id: this.d.ids.next(),
          userId,
          itemId: v.itemId,
          scheduleVersionId: v.id,
          scheduledAt: s.scheduledAt,
          localDate: s.localDate,
          localTime: s.localTime,
          nameSnapshot: item.name,
          doseSnapshot: v.doseSnapshot,
          unitSnapshot: v.unitSnapshot,
          itemType: item.type,
        });
      }
    }
    if (slots.length === 0) return 0;
    const created = await this.d.occurrences.upsertSlots(slots, this.d.clock.now(), tx);
    for (const id of created) await this.d.changeLog.record(tx, userId, { entity: 'occurrence', id, op: 'upsert' });
    return created.length;
  }
}
