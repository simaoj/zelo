/**
 * Pure functions that reproduce server read semantics over locally replicated data
 * (history paging, deltaKg, occurrence state derivation, dashboard composition).
 */
import type {
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

export function composeDashboard(input: {
  date: string;
  profile: Profile;
  weights: WeightEntry[];
  bloodPressure: BloodPressureEntry[];
  measurements: MeasurementSession[];
  occurrences: Occurrence[];
  now: Date;
}): DashboardResponse {
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
  };
}
