import { describe, expect, it } from 'vitest';
import { UnprocessableInputError, ValidationError } from '../../../shared/domain/errors.js';
import { parseHaeDate, parseHealthExport } from '../adapters/in/http/health-export/health-export-parser.js';
import { fixture } from './fixtures.js';

function expectError(fn: () => unknown, kind: typeof ValidationError | typeof UnprocessableInputError, path?: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(kind);
    if (kind === ValidationError) expect(err).not.toBeInstanceOf(UnprocessableInputError);
    if (path) expect(Object.keys((err as ValidationError).fieldErrors)).toContain(path);
    return err as ValidationError;
  }
  throw new Error('expected an error');
}

const workout = (over: Record<string, unknown> = {}) => ({ data: { workouts: [{ ...fixture('workout-v2').data.workouts![0], ...over }] } });

describe('parseHaeDate', () => {
  it('keeps the export offset and its local date (-0300, +0000, +0530)', () => {
    expect(parseHaeDate('2026-10-18 00:00:00 -0300')).toEqual({ instant: new Date('2026-10-18T03:00:00.000Z'), localDate: '2026-10-18', offsetMinutes: -180 });
    expect(parseHaeDate('2026-10-18 23:59:59 +0000')).toEqual({ instant: new Date('2026-10-18T23:59:59.000Z'), localDate: '2026-10-18', offsetMinutes: 0 });
    // 00:10 local in India is still the previous day in UTC — the local date must come from the export
    expect(parseHaeDate('2026-10-18 00:10:00 +0530')).toEqual({ instant: new Date('2026-10-17T18:40:00.000Z'), localDate: '2026-10-18', offsetMinutes: 330 });
  });
  it('rejects other formats instead of guessing', () => {
    for (const v of ['2026-10-18T00:00:00-03:00', '2026-10-18 00:00:00', '2026-10-18', '2026-13-01 00:00:00 -0300', '2026-02-30 00:00:00 -0300', 1760000000, null]) {
      expect(parseHaeDate(v)).toBeNull();
    }
  });
});

describe('parseHealthExport', () => {
  it('metrics only (spec example)', () => {
    expect(parseHealthExport(fixture('steps'))).toEqual({ steps: [{ localDate: '2026-10-18', count: 6842, offsetMinutes: -180 }], workouts: [], ignoredMetrics: [] });
  });

  it('workouts only (spec example), km → m, kcal kept', () => {
    const r = parseHealthExport(fixture('workout-v2'));
    expect(r.steps).toEqual([]);
    expect(r.workouts).toEqual([
      {
        externalId: '706e08a9-66a1-4820-83dd-f7c6e314ff66',
        name: 'Running',
        startedAt: new Date('2026-10-18T10:00:00.000Z'),
        endedAt: new Date('2026-10-18T10:30:00.000Z'),
        startOffsetMinutes: -180,
        localDate: '2026-10-18',
        durationSeconds: 1800,
        distanceMeters: 4200,
        activeEnergyKcal: 310,
      },
    ]);
  });

  it('both in the same envelope', () => {
    const r = parseHealthExport(fixture('combined'));
    expect(r.steps.map((s) => s.localDate)).toEqual(['2026-10-17', '2026-10-18']);
    expect(r.workouts).toHaveLength(1);
  });

  it('empty arrays and absent arrays are valid', () => {
    expect(parseHealthExport({ data: { metrics: [], workouts: [] } })).toEqual({ steps: [], workouts: [], ignoredMetrics: [] });
    expect(parseHealthExport({ data: {} })).toEqual({ steps: [], workouts: [], ignoredMetrics: [] });
    expect(parseHealthExport({ data: { metrics: [{ name: 'step_count', units: 'count', data: [] }] } }).steps).toEqual([]);
  });

  it('missing envelope → 400', () => {
    expectError(() => parseHealthExport({ metrics: [] }), ValidationError, 'data');
    expectError(() => parseHealthExport([]), ValidationError, 'data');
    expectError(() => parseHealthExport({ data: { workouts: {} } }), ValidationError, 'data.workouts');
  });

  it('optional workout fields absent → null (never invented)', () => {
    const w = { ...fixture('workout-v2').data.workouts![0] };
    delete w.distance;
    delete w.activeEnergyBurned;
    const r = parseHealthExport({ data: { workouts: [w] } });
    expect(r.workouts[0]).toMatchObject({ distanceMeters: null, activeEnergyKcal: null });
  });

  it('distance: mi (international mile) and m', () => {
    expect(parseHealthExport(workout({ distance: { qty: 1, units: 'mi' } })).workouts[0]!.distanceMeters).toBe(1609.34);
    expect(parseHealthExport(workout({ distance: { qty: 3.1, units: 'mi' } })).workouts[0]!.distanceMeters).toBe(4988.97);
    expect(parseHealthExport(workout({ distance: { qty: 850, units: 'm' } })).workouts[0]!.distanceMeters).toBe(850);
  });

  it('energy: kJ → kcal (1 kcal = 4.184 kJ)', () => {
    expect(parseHealthExport(workout({ activeEnergyBurned: { qty: 1297.04, units: 'kJ' } })).workouts[0]!.activeEnergyKcal).toBe(310);
  });

  it('unknown units → 400 with a clear path', () => {
    expectError(() => parseHealthExport(workout({ distance: { qty: 4, units: 'yd' } })), ValidationError, 'data.workouts.0.distance.units');
    expectError(() => parseHealthExport(workout({ activeEnergyBurned: { qty: 4, units: 'Cal' } })), ValidationError, 'data.workouts.0.activeEnergyBurned.units');
    expectError(() => parseHealthExport(workout({ distance: { qty: -1, units: 'km' } })), ValidationError, 'data.workouts.0.distance.qty');
  });

  it('end before start → 400', () => {
    expectError(() => parseHealthExport(workout({ end: '2026-10-18 06:59:59 -0300' })), ValidationError, 'data.workouts.0.end');
  });

  it('end == start is accepted; start/end with different offsets compare as instants', () => {
    expect(parseHealthExport(workout({ end: '2026-10-18 07:00:00 -0300', duration: 0 })).workouts).toHaveLength(1);
    // 10:10Z vs 10:00Z → valid although the wall-clock of `end` looks earlier
    expect(parseHealthExport(workout({ end: '2026-10-18 10:10:00 +0000' })).workouts).toHaveLength(1);
  });

  it('duration is kept as sent (not recomputed from start/end)', () => {
    expect(parseHealthExport(workout({ duration: 1500.5 })).workouts[0]!.durationSeconds).toBe(1500.5);
  });

  it('required workout fields', () => {
    const w = { ...fixture('workout-v2').data.workouts![0] };
    delete w.id;
    delete w.duration;
    const err = expectError(() => parseHealthExport({ data: { workouts: [w] } }), ValidationError);
    expect(Object.keys(err.fieldErrors).sort()).toEqual(['data.workouts.0.duration', 'data.workouts.0.id']);
    expectError(() => parseHealthExport(workout({ duration: '1800' })), ValidationError, 'data.workouts.0.duration');
    expectError(() => parseHealthExport(workout({ start: '2026-10-18T07:00:00-03:00' })), ValidationError, 'data.workouts.0.start');
  });

  it('totalEnergy, route and heart-rate data are ignored (not converted, not returned)', () => {
    const r = parseHealthExport(
      workout({
        totalEnergy: { qty: 999, units: 'kcal' },
        route: [{ latitude: -23.5, longitude: -46.6, altitude: 760, timestamp: '2026-10-18 07:00:00 -0300' }],
        heartRateData: [{ date: '2026-10-18 07:00:00 -0300', Avg: 120, units: 'bpm' }],
        location: 'Outdoor',
      }),
    );
    expect(r.workouts[0]!.activeEnergyKcal).toBe(310);
    expect(JSON.stringify(r)).not.toMatch(/999|latitude|heartRate|Outdoor/);
  });

  it('activeEnergyBurned absent but totalEnergy present → energy stays null', () => {
    const w: Record<string, unknown> = { ...fixture('workout-v2').data.workouts![0], totalEnergy: { qty: 400, units: 'kcal' } };
    delete w.activeEnergyBurned;
    expect(parseHealthExport({ data: { workouts: [w] } }).workouts[0]!.activeEnergyKcal).toBeNull();
  });

  it('same day twice → 422, never summed', () => {
    const body = fixture('steps');
    body.data.metrics![0]!.data = [
      { date: '2026-10-18 00:00:00 -0300', qty: 4000, source: 'iPhone' },
      { date: '2026-10-18 00:00:00 -0300', qty: 2842, source: 'Apple Watch' },
    ];
    expectError(() => parseHealthExport(body), UnprocessableInputError, 'data.metrics.0.data.1');
  });

  it('per-interval points of the same day (non-summarized export) → 422', () => {
    const body = fixture('steps');
    body.data.metrics![0]!.data = [
      { date: '2026-10-18 08:00:00 -0300', qty: 120 },
      { date: '2026-10-18 09:00:00 -0300', qty: 300 },
    ];
    expectError(() => parseHealthExport(body), UnprocessableInputError);
  });

  it('interval-shaped points (startDate/endDate) → 422', () => {
    const body = fixture('steps');
    body.data.metrics![0]!.data = [{ startDate: '2026-10-18 08:00:00 -0300', endDate: '2026-10-18 09:00:00 -0300', qty: 120 }];
    expectError(() => parseHealthExport(body), UnprocessableInputError, 'data.metrics.0.data.0');
  });

  it('a single summarized point with `source` metadata is accepted (source is not stored)', () => {
    const body = fixture('steps');
    body.data.metrics![0]!.data = [{ date: '2026-10-18 00:00:00 -0300', qty: 6842, source: 'iPhone|Apple Watch' }];
    expect(parseHealthExport(body).steps).toEqual([{ localDate: '2026-10-18', count: 6842, offsetMinutes: -180 }]);
  });

  it('step qty must be a non-negative integer → 400', () => {
    for (const qty of [6842.5, -1, '6842', null]) {
      const body = fixture('steps');
      body.data.metrics![0]!.data = [{ date: '2026-10-18 00:00:00 -0300', qty }];
      expectError(() => parseHealthExport(body), ValidationError, 'data.metrics.0.data.0.qty');
    }
  });

  it('zero steps is a real value', () => {
    const body = fixture('steps');
    body.data.metrics![0]!.data = [{ date: '2026-10-18 00:00:00 -0300', qty: 0 }];
    expect(parseHealthExport(body).steps[0]!.count).toBe(0);
  });

  it('step_count with another unit → 400', () => {
    const body = fixture('steps');
    body.data.metrics![0]!.units = 'steps';
    expectError(() => parseHealthExport(body), ValidationError, 'data.metrics.0.units');
  });

  it('other metrics are ignored (reported, not stored) and do not block step totals', () => {
    const body = fixture('steps');
    body.data.metrics!.push({ name: 'heart_rate', units: 'count/min', data: [{ date: '2026-10-18 08:00:00 -0300', Min: 60, Avg: 70, Max: 90 }] });
    const r = parseHealthExport(body);
    expect(r.steps).toHaveLength(1);
    expect(r.ignoredMetrics).toEqual(['heart_rate']);
  });

  it('validates the whole batch: one bad workout rejects everything', () => {
    const body = fixture('combined');
    body.data.workouts!.push({ ...body.data.workouts![0], id: 'other', distance: { qty: 1, units: 'furlong' } });
    expectError(() => parseHealthExport(body), ValidationError, 'data.workouts.1.distance.units');
  });

  it('same workout id twice: identical → kept once; different → 422', () => {
    const w = fixture('workout-v2').data.workouts![0]!;
    expect(parseHealthExport({ data: { workouts: [w, { ...w }] } }).workouts).toHaveLength(1);
    expectError(() => parseHealthExport({ data: { workouts: [w, { ...w, duration: 1700 }] } }), UnprocessableInputError, 'data.workouts.1.id');
  });

  it('a userId in the payload is irrelevant (never read)', () => {
    const body = { ...fixture('steps'), userId: 'someone-else', data: { ...fixture('steps').data, userId: 'x' } };
    expect(JSON.stringify(parseHealthExport(body))).not.toContain('someone-else');
  });
});
