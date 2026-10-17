import type { DashboardResponse, Occurrence } from '@zelo/contracts';
import type { Clock } from '../../../../shared/application/ports.js';
import type { HealthSnapshotReader, ProfileReader } from '../../../../shared/application/cross-module-ports.js';
import { ValidationError } from '../../../../shared/domain/errors.js';

/** Port to the routine module (implemented by routine's public OccurrenceQuery). */
export interface DailyOccurrences {
  listForDate(userId: string, localDate: string): Promise<Occurrence[]>;
}

export const SPARKLINE_POINTS = 30;

function localToday(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new ValidationError('Data inválida', { date: ['Use o formato AAAA-MM-DD'] });
  }
}

/**
 * GetDailyDashboard — "Hoje" summary. `date` defaults to today in the PROFILE timezone.
 * Latest weight/BP/measurement are the most recent records overall (with their own dates, so the UI
 * can flag old ones — never presented as today's); occurrences are those of `date`, by scheduledAt.
 */
export class GetDailyDashboard {
  constructor(
    private readonly d: { profiles: ProfileReader; snapshots: HealthSnapshotReader; occurrences: DailyOccurrences; clock: Clock },
  ) {}

  async execute(userId: string, date?: string): Promise<DashboardResponse> {
    const timezone = await this.d.profiles.getTimezone(userId);
    const day = date ?? localToday(this.d.clock.now(), timezone);
    assertDate(day);
    const [displayName, latestWeight, weightSparkline, latestBloodPressure, latestMeasurement, occurrences] = await Promise.all([
      this.d.profiles.getDisplayName(userId),
      this.d.snapshots.latestWeight(userId),
      this.d.snapshots.recentWeights(userId, SPARKLINE_POINTS),
      this.d.snapshots.latestBloodPressure(userId),
      this.d.snapshots.latestMeasurement(userId),
      this.d.occurrences.listForDate(userId, day),
    ]);
    return {
      date: day,
      timezone,
      displayName,
      latestWeight,
      weightSparkline: [...weightSparkline].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
      latestBloodPressure,
      latestMeasurement,
      occurrences: [...occurrences].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    };
  }
}
