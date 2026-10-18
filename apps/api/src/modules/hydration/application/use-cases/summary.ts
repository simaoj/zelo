import type { DashboardResponse, HydrationSummary } from '@zelo/contracts';
import type { Actor, Clock } from '../../../../shared/application/ports.js';
import { assertSummaryRange, averageOnRecordedDays, dailyTotals } from '../../domain/daily-totals.js';
import { addDays, localDateOf, localRange } from '../../domain/local-date.js';
import type { WaterEntryRepository, TimezoneProvider } from '../ports/index.js';
import type { HydrationGoalUseCases } from './hydration-goal.js';

/** Days (including today) replicated to devices at bootstrap. */
export const BOOTSTRAP_DAYS = 90;

export class GetHydrationSummary {
  constructor(
    private readonly repo: WaterEntryRepository,
    private readonly goals: HydrationGoalUseCases,
    private readonly tz: TimezoneProvider,
  ) {}

  async execute(actor: Actor, q: { from: string; to: string }): Promise<HydrationSummary> {
    assertSummaryRange(q.from, q.to);
    const timezone = await this.tz.getTimezone(actor.userId);
    const range = localRange(q.from, q.to, timezone);
    const entries = await this.repo.listLiveBetween(actor.userId, range.from, range.to);
    const days = dailyTotals(entries, q.from, q.to, timezone);
    return {
      timezone,
      from: q.from,
      to: q.to,
      days,
      goal: await this.goals.find(actor.userId),
      averageMlOnRecordedDays: averageOnRecordedDays(days),
    };
  }
}

/** Water of one local date (dashboard). */
export class GetHydrationDay {
  constructor(
    private readonly repo: WaterEntryRepository,
    private readonly goals: HydrationGoalUseCases,
  ) {}

  async execute(userId: string, date: string, timezone: string): Promise<DashboardResponse['hydration']> {
    const range = localRange(date, date, timezone);
    const entries = await this.repo.listLiveBetween(userId, range.from, range.to);
    const total = entries.reduce((s, e) => s + e.amountMl, 0);
    const last = entries.reduce<Date | null>((m, e) => (!m || e.consumedAt > m ? e.consumedAt : m), null);
    return {
      totalMl: entries.length ? total : null,
      entryCount: entries.length,
      goal: await this.goals.find(userId),
      lastEntryAt: last ? last.toISOString() : null,
    };
  }
}

/** Start instant of the sync bootstrap window: the last BOOTSTRAP_DAYS local days (incl. today) in the profile tz. */
export async function bootstrapWindowStart(userId: string, clock: Clock, tz: TimezoneProvider): Promise<Date> {
  const timezone = await tz.getTimezone(userId);
  const today = localDateOf(clock.now(), timezone);
  return localRange(addDays(today, -(BOOTSTRAP_DAYS - 1)), today, timezone).from;
}
