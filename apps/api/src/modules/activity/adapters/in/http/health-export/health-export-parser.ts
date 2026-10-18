/**
 * Inbound adapter: Health Auto Export JSON (REST API automation, JSON format, workouts v2)
 * → validated internal command. Pure function; no I/O.
 *
 * Based on the official docs (help.healthyapps.dev/en/health-auto-export):
 *  - envelope `{ data: { metrics?: [], workouts?: [], ...other arrays } }` (export-format)
 *  - dates `yyyy-MM-dd HH:mm:ss Z`, e.g. `2024-02-06 14:30:00 -0800` (export-format)
 *  - metric `{ name (snake_case), units, data: [{ date, qty, source? }] }`; step_count / count (health-metrics)
 *  - workout v2 required `id, name, start, end, duration (s)`; optional `distance`, `activeEnergyBurned`,
 *    `totalEnergy` (active + resting), `route`, `heartRateData`, ... as `{qty, units}` objects (workouts)
 *
 * The WHOLE batch is validated before anything is returned:
 *  - structural problems → ValidationError (HTTP 400) with `fieldErrors` keyed by JSON path;
 *  - well-formed data that is not a consolidated daily total → UnprocessableInputError (HTTP 422).
 *
 * Decisions (see docs/activity-import.md):
 *  - Metrics other than `step_count` are IGNORED (reported back as `ignoredMetrics`, never stored):
 *    the docs envelope may carry any metric the user selected, and refusing the whole batch would
 *    also drop valid step totals. `step_count` with units other than `count` → 400.
 *  - `source` is documented as optional metadata ("when available") also on summarized data, so its
 *    presence is not by itself a rejection reason and it is never stored. Per-source / interval data
 *    is detected by shape: the same local date more than once (→ 422, never summed) or points with
 *    interval fields (`startDate`/`endDate`) (→ 422). A single timestamp is never taken as proof that a
 *    point is daily (the docs do not specify the timestamp of summarized points).
 *  - Workout `duration` is kept as sent (not recomputed); `totalEnergy`, `route`, heart-rate data and
 *    every other optional field are ignored and not persisted.
 */
import { DateTime } from 'luxon';
import { UnprocessableInputError, ValidationError } from '../../../../../../shared/domain/errors.js';
import type { HealthExportCommand } from '../../../../application/use-cases/receive-health-export.js';
import type { StepsValues, WorkoutValues } from '../../../../domain/activity.js';

export const HAE_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss ZZZ';
const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/;

export const STEP_METRIC = 'step_count';
export const STEP_UNITS = 'count';

/** meters per unit (mi = international mile) */
const DISTANCE_TO_METERS: Record<string, number> = { m: 1, km: 1000, mi: 1609.344 };
/** kcal per unit (thermochemical calorie: 1 kcal = 4.184 kJ) */
const ENERGY_TO_KCAL: Record<string, number> = { kcal: 1, kj: 1 / 4.184 };

export interface ParsedHealthExport extends HealthExportCommand {
  /** names of metrics present in the payload but outside this version's scope (not stored) */
  ignoredMetrics: string[];
}

export interface ParsedTimestamp {
  instant: Date;
  localDate: string;
  offsetMinutes: number;
}

/** Explicit parse of `yyyy-MM-dd HH:mm:ss Z`, keeping the export's own offset. Never `new Date(string)`. */
export function parseHaeDate(value: unknown): ParsedTimestamp | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const dt = DateTime.fromFormat(value, HAE_DATE_FORMAT, { setZone: true });
  if (!dt.isValid) return null;
  return { instant: dt.toJSDate(), localDate: dt.toISODate()!, offsetMinutes: dt.offset };
}

const round = (n: number, decimals: number) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

class Problems {
  readonly invalid: Record<string, string[]> = {};
  readonly incompatible: Record<string, string[]> = {};
  bad(path: string, msg: string) {
    (this.invalid[path] ??= []).push(msg);
  }
  unprocessable(path: string, msg: string) {
    (this.incompatible[path] ??= []).push(msg);
  }
}

function parseQuantity(
  raw: unknown,
  path: string,
  factors: Record<string, number>,
  unitsLabel: string,
  p: Problems,
  caseInsensitive = false,
): number | null {
  if (raw === undefined || raw === null) return null;
  if (!isObject(raw)) {
    p.bad(path, 'Esperado objeto {qty, units}');
    return null;
  }
  const qty = raw.qty;
  if (!isFiniteNumber(qty) || qty < 0) p.bad(`${path}.qty`, 'Use um número finito ≥ 0');
  const units = typeof raw.units === 'string' ? (caseInsensitive ? raw.units.toLowerCase() : raw.units) : undefined;
  const factor = units !== undefined ? factors[units] : undefined;
  if (factor === undefined) p.bad(`${path}.units`, `Unidade não suportada (use ${unitsLabel})`);
  if (!isFiniteNumber(qty) || qty < 0 || factor === undefined) return null;
  return round(qty * factor, 2);
}

function parseSteps(metrics: unknown[], p: Problems, ignored: Set<string>): StepsValues[] {
  const steps: StepsValues[] = [];
  const seen = new Map<string, string>(); // localDate → first path
  metrics.forEach((m, mi) => {
    const mp = `data.metrics.${mi}`;
    if (!isObject(m)) return p.bad(mp, 'Esperado objeto {name, units, data}');
    if (typeof m.name !== 'string' || !m.name) return p.bad(`${mp}.name`, 'Obrigatório');
    if (m.name !== STEP_METRIC) {
      ignored.add(m.name.slice(0, 64));
      return;
    }
    if (m.units !== STEP_UNITS) p.bad(`${mp}.units`, `Para ${STEP_METRIC} use a unidade "${STEP_UNITS}"`);
    if (!Array.isArray(m.data)) return p.bad(`${mp}.data`, 'Esperado array');
    m.data.forEach((pt, pi) => {
      const pp = `${mp}.data.${pi}`;
      if (!isObject(pt)) return p.bad(pp, 'Esperado objeto {date, qty}');
      if ('startDate' in pt || 'endDate' in pt) {
        p.unprocessable(pp, 'Ponto com intervalo (startDate/endDate): envie totais diários consolidados');
        return;
      }
      const ts = parseHaeDate(pt.date);
      if (!ts) p.bad(`${pp}.date`, 'Use o formato yyyy-MM-dd HH:mm:ss Z');
      const qty = pt.qty;
      if (!isFiniteNumber(qty)) p.bad(`${pp}.qty`, 'Obrigatório (número)');
      else if (!Number.isInteger(qty) || qty < 0) p.bad(`${pp}.qty`, 'Passos devem ser um inteiro não negativo');
      if (!ts || !isFiniteNumber(qty) || !Number.isInteger(qty) || qty < 0) return;
      const first = seen.get(ts.localDate);
      if (first) {
        p.unprocessable(pp, `Mais de um ponto para ${ts.localDate} (também em ${first}): envie um total consolidado por dia (resumo diário ativado)`);
        return;
      }
      seen.set(ts.localDate, pp);
      steps.push({ localDate: ts.localDate, count: qty, offsetMinutes: ts.offsetMinutes });
    });
  });
  return steps;
}

function parseWorkouts(workouts: unknown[], p: Problems): WorkoutValues[] {
  const out = new Map<string, { path: string; value: WorkoutValues }>();
  workouts.forEach((w, wi) => {
    const wp = `data.workouts.${wi}`;
    if (!isObject(w)) return p.bad(wp, 'Esperado objeto de exercício (versão 2)');
    const before = Object.keys(p.invalid).length;
    const id = typeof w.id === 'string' ? w.id.trim() : '';
    if (!id || id.length > 200) p.bad(`${wp}.id`, 'Obrigatório (texto até 200 caracteres)');
    const name = typeof w.name === 'string' ? w.name.trim() : '';
    if (!name || name.length > 100) p.bad(`${wp}.name`, 'Obrigatório (texto até 100 caracteres)');
    const start = parseHaeDate(w.start);
    if (!start) p.bad(`${wp}.start`, 'Use o formato yyyy-MM-dd HH:mm:ss Z');
    const end = parseHaeDate(w.end);
    if (!end) p.bad(`${wp}.end`, 'Use o formato yyyy-MM-dd HH:mm:ss Z');
    if (start && end && end.instant.getTime() < start.instant.getTime()) p.bad(`${wp}.end`, 'O fim não pode preceder o início');
    const duration = w.duration;
    if (!isFiniteNumber(duration) || duration < 0) p.bad(`${wp}.duration`, 'Obrigatório: segundos (número finito ≥ 0)');
    const distanceMeters = parseQuantity(w.distance, `${wp}.distance`, DISTANCE_TO_METERS, 'km, mi ou m', p);
    const activeEnergyKcal = parseQuantity(w.activeEnergyBurned, `${wp}.activeEnergyBurned`, ENERGY_TO_KCAL, 'kcal ou kJ', p, true);
    // totalEnergy (active + resting), route, heartRate*, etc. are intentionally ignored.
    if (Object.keys(p.invalid).length !== before || !start || !end || !isFiniteNumber(duration)) return;
    const value: WorkoutValues = {
      externalId: id,
      name,
      startedAt: start.instant,
      endedAt: end.instant,
      startOffsetMinutes: start.offsetMinutes,
      localDate: start.localDate,
      durationSeconds: duration,
      distanceMeters,
      activeEnergyKcal,
    };
    const prev = out.get(id);
    if (prev) {
      const same = JSON.stringify(prev.value) === JSON.stringify(value);
      if (!same) p.unprocessable(`${wp}.id`, `Exercício ${id} repetido no lote com dados diferentes (também em ${prev.path})`);
      return; // identical repetition: kept once
    }
    out.set(id, { path: wp, value });
  });
  return [...out.values()].map((v) => v.value);
}

/** Parses and validates a whole Health Auto Export JSON body. Throws on the first failing batch (all problems reported). */
export function parseHealthExport(body: unknown): ParsedHealthExport {
  const p = new Problems();
  if (!isObject(body) || !isObject(body.data)) {
    throw new ValidationError('Formato inválido: esperado {"data": {"metrics": [...], "workouts": [...]}}', { data: ['Obrigatório (objeto)'] });
  }
  const { metrics, workouts } = body.data;
  if (metrics !== undefined && !Array.isArray(metrics)) p.bad('data.metrics', 'Esperado array');
  if (workouts !== undefined && !Array.isArray(workouts)) p.bad('data.workouts', 'Esperado array');
  const ignored = new Set<string>();
  const steps = Array.isArray(metrics) ? parseSteps(metrics, p, ignored) : [];
  const parsedWorkouts = Array.isArray(workouts) ? parseWorkouts(workouts, p) : [];
  if (Object.keys(p.invalid).length) throw new ValidationError('Confira os campos do envio.', p.invalid);
  if (Object.keys(p.incompatible).length) {
    throw new UnprocessableInputError('Os dados não são totais diários consolidados compatíveis com o Zelo.', p.incompatible);
  }
  return { steps, workouts: parsedWorkouts, ignoredMetrics: [...ignored] };
}
