/**
 * Pure functions that reproduce server read semantics over locally replicated data
 * (history paging, deltaKg, occurrence state derivation, dashboard composition).
 */
import type {
  ActivityGoal,
  ActivityToday,
  DailySteps,
  HydrationDay,
  HydrationGoal,
  HydrationSummary,
  StepsDay,
  StepsSummary,
  WaterEntry,
  Workout,
  WorkoutPage,
  WorkoutsQuery,
  DashboardResponse,
  HistoryQuery,
  MeasurementSession,
  Occurrence,
  OccurrenceState,
  Profile,
  WeightEntry,
  BloodPressureEntry,
} from '@zelo/contracts';

type Timed = { id: string; measuredAt: string };

const DEFAULT_LIMIT = 50;

/** desc by measuredAt, then id desc (server order). */
export function byMeasuredDesc(a: Timed, b: Timed) {
  if (a.measuredAt !== b.measuredAt) return Date.parse(b.measuredAt) - Date.parse(a.measuredAt);
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function encodeCursor(item: Timed) {
  return `local:${btoa(`${item.measuredAt}|${item.id}`)}`;
}
function decodeCursor(cursor: string): Timed | null {
  if (!cursor.startsWith('local:')) return null;
  try {
    const [measuredAt, id] = atob(cursor.slice(6)).split('|');
    return measuredAt && id ? { measuredAt, id } : null;
  } catch {
    return null;
  }
}

/** Cursor paging identical to the API: [from, to), ordered desc, `limit` default 50 (max 200). */
export function pageLocal<T extends Timed>(items: T[], q: HistoryQuery): { items: T[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), 200);
  const from = q.from ? Date.parse(q.from) : -Infinity;
  const to = q.to ? Date.parse(q.to) : Infinity;
  let sorted = items
    .filter((i) => {
      const t = Date.parse(i.measuredAt);
      return t >= from && t < to;
    })
    .sort(byMeasuredDesc);
  const after = q.cursor ? decodeCursor(q.cursor) : null;
  if (after) sorted = sorted.filter((i) => byMeasuredDesc(after, i) < 0);
  const pageItems = sorted.slice(0, limit);
  const nextCursor = sorted.length > limit ? encodeCursor(pageItems[pageItems.length - 1]!) : null;
  return { items: pageItems, nextCursor };
}

// ---------- decimals (exact, no floating point) ----------

function toHundredths(v: string): bigint {
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = (neg ? v.slice(1) : v).split('.');
  const n = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -n : n;
}
function fromHundredths(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const int = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}
export function subtractDecimal(a: string, b: string): string {
  return fromHundredths(toHundredths(a) - toHundredths(b));
}

/** Recomputes deltaKg = weight − chronologically previous weight (null for the first). */
export function withDeltas(entries: WeightEntry[]): WeightEntry[] {
  const asc = [...entries].sort((a, b) => -byMeasuredDesc(a, b));
  return asc.map((e, idx) => ({ ...e, deltaKg: idx === 0 ? null : subtractDecimal(e.weightKg, asc[idx - 1]!.weightKg) }));
}

// ---------- occurrences ----------

export function deriveOccurrenceState(o: Occurrence, now: Date): OccurrenceState {
  if (o.intake) return o.intake.status;
  return Date.parse(o.scheduledAt) > now.getTime() ? 'scheduled' : 'unrecorded';
}

export function withDerivedState(list: Occurrence[], now: Date): Occurrence[] {
  return [...list]
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || (a.id < b.id ? -1 : 1))
    .map((o) => ({ ...o, state: deriveOccurrenceState(o, now) }));
}

/** YYYY-MM-DD for `now` in an IANA timezone. */
export function localDateIn(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Inclusive list of YYYY-MM-DD dates (calendar arithmetic, tz-independent). Empty if from > to. */
export function datesBetween(from: string, to: string, max = 400): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  for (let t = Date.parse(`${from}T00:00:00.000Z`); t <= end && out.length < max; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const maxIso = (values: Array<string | null | undefined>): string | null =>
  values.reduce<string | null>((acc, v) => (v && (!acc || Date.parse(v) > Date.parse(acc)) ? v : acc), null);

// ---------- hydration ----------

/** Water history paging: same semantics as the API ([from, to) on consumedAt, desc, cursor). */
export function pageWater(entries: WaterEntry[], q: HistoryQuery): { items: WaterEntry[]; nextCursor: string | null } {
  const res = pageLocal(entries.map((e) => ({ ...e, measuredAt: e.consumedAt })), q);
  return {
    items: res.items.map(({ measuredAt: _m, ...e }) => {
      void _m;
      return e as WaterEntry;
    }),
    nextCursor: res.nextCursor,
  };
}

/** Groups water by local date in the PROFILE timezone. Days without records → totalMl null. */
export function summarizeHydration(input: { from: string; to: string; timezone: string; entries: WaterEntry[]; goal: HydrationGoal | null }): HydrationSummary {
  const byDay = new Map<string, { total: number; count: number }>();
  for (const e of input.entries) {
    const d = localDateIn(input.timezone, new Date(e.consumedAt));
    const cur = byDay.get(d) ?? { total: 0, count: 0 };
    cur.total += e.amountMl;
    cur.count += 1;
    byDay.set(d, cur);
  }
  const days: HydrationDay[] = datesBetween(input.from, input.to).map((date) => {
    const v = byDay.get(date);
    return { date, totalMl: v ? v.total : null, entryCount: v?.count ?? 0 };
  });
  const recorded = days.filter((d) => d.totalMl !== null);
  return {
    timezone: input.timezone,
    from: input.from,
    to: input.to,
    days,
    goal: input.goal,
    averageMlOnRecordedDays: recorded.length ? Math.round(recorded.reduce((a, d) => a + d.totalMl!, 0) / recorded.length) : null,
  };
}

export function hydrationForDay(date: string, timezone: string, entries: WaterEntry[], goal: HydrationGoal | null): DashboardResponse['hydration'] {
  const ofDay = entries.filter((e) => localDateIn(timezone, new Date(e.consumedAt)) === date);
  return {
    totalMl: ofDay.length ? ofDay.reduce((a, e) => a + e.amountMl, 0) : null,
    entryCount: ofDay.length,
    goal,
    lastEntryAt: maxIso(ofDay.map((e) => e.consumedAt)),
  };
}

// ---------- activity (read-only replica) ----------

export function lastActivityReceivedAt(steps: DailySteps[], workouts: Workout[]): string | null {
  return maxIso([...steps.map((s) => s.receivedAt), ...workouts.map((w) => w.receivedAt)]);
}

function stepsDay(date: string, today: string, rec: DailySteps | undefined): StepsDay {
  return { date, count: rec ? rec.count : null, partial: date === today, receivedAt: rec?.receivedAt ?? null };
}

/** count null = no data received; 0 = reported zero; `partial` for today (profile tz). */
export function summarizeSteps(input: { from: string; to: string; today: string; steps: DailySteps[]; workouts: Workout[]; goal: ActivityGoal | null }): StepsSummary {
  const byDate = new Map(input.steps.map((s) => [s.localDate, s]));
  const days = datesBetween(input.from, input.to).map((d) => stepsDay(d, input.today, byDate.get(d)));
  const withData = days.filter((d) => d.count !== null);
  return {
    from: input.from,
    to: input.to,
    days,
    goal: input.goal,
    averageOnDaysWithData: withData.length ? Math.round(withData.reduce((a, d) => a + d.count!, 0) / withData.length) : null,
    lastReceivedAt: lastActivityReceivedAt(input.steps, input.workouts),
  };
}

export function activityForDay(input: { date: string; today: string; steps: DailySteps[]; workouts: Workout[]; goal: ActivityGoal | null }): ActivityToday {
  const ofDay = input.workouts.filter((w) => w.localDate === input.date);
  return {
    date: input.date,
    steps: stepsDay(input.date, input.today, input.steps.find((s) => s.localDate === input.date)),
    stepsGoal: input.goal,
    workoutCount: ofDay.length,
    workoutSeconds: ofDay.reduce((a, w) => a + w.durationSeconds, 0),
    lastReceivedAt: lastActivityReceivedAt(input.steps, input.workouts),
  };
}

/** Workouts ordered by startedAt desc; from/to are inclusive local dates; name is exact. */
export function pageWorkouts(workouts: Workout[], q: WorkoutsQuery): WorkoutPage {
  const filtered = workouts.filter(
    (w) => (!q.from || w.localDate >= q.from) && (!q.to || w.localDate <= q.to) && (!q.name || w.name === q.name),
  );
  const res = pageLocal(filtered.map((w) => ({ ...w, measuredAt: w.startedAt })), { cursor: q.cursor, limit: q.limit });
  return {
    items: res.items.map(({ measuredAt: _m, ...w }) => {
      void _m;
      return w as Workout;
    }),
    nextCursor: res.nextCursor,
    availableNames: [...new Set(workouts.map((w) => w.name))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
  };
}

export function composeDashboard(input: {
  date: string;
  profile: Profile;
  weights: WeightEntry[];
  bloodPressure: BloodPressureEntry[];
  measurements: MeasurementSession[];
  occurrences: Occurrence[];
  water: WaterEntry[];
  hydrationGoal: HydrationGoal | null;
  steps: DailySteps[];
  workouts: Workout[];
  activityGoal: ActivityGoal | null;
  now: Date;
}): DashboardResponse {
  const today = localDateIn(input.profile.timezone, input.now);
  const weightsDesc = withDeltas(input.weights).sort(byMeasuredDesc);
  const sparkline = weightsDesc
    .slice(0, 30)
    .reverse()
    .map((w) => ({ measuredAt: w.measuredAt, weightKg: w.weightKg }));
  return {
    date: input.date,
    timezone: input.profile.timezone,
    displayName: input.profile.displayName,
    latestWeight: weightsDesc[0] ?? null,
    weightSparkline: sparkline,
    latestBloodPressure: [...input.bloodPressure].sort(byMeasuredDesc)[0] ?? null,
    latestMeasurement: [...input.measurements].sort(byMeasuredDesc)[0] ?? null,
    occurrences: withDerivedState(
      input.occurrences.filter((o) => o.localDate === input.date),
      input.now,
    ),
    hydration: hydrationForDay(input.date, input.profile.timezone, input.water, input.hydrationGoal),
    activity: activityForDay({ date: input.date, today, steps: input.steps, workouts: input.workouts, goal: input.activityGoal }),
  };
}
