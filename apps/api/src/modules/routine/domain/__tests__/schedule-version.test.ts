import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../shared/domain/errors.js';
import { createScheduleVersion, planSlots, validateScheduleSpec, type ScheduleSpec } from '../entities/schedule-version.js';

const base: ScheduleSpec = {
  frequency: 'daily',
  weekdays: [],
  times: ['08:00'],
  timezone: 'America/Sao_Paulo',
  startDate: '2026-10-01',
  endDate: null,
  reminderEnabled: true,
};

function version(spec: Partial<ScheduleSpec>, now = new Date('2026-09-01T00:00:00Z'), isFirst = true) {
  return createScheduleVersion({
    id: 'v1',
    userId: 'u1',
    itemId: 'i1',
    spec: { ...base, ...spec },
    dose: '1',
    unit: 'comprimido',
    now,
    isFirst,
  });
}

const keys = (slots: ReturnType<typeof planSlots>) => slots.map((s) => `${s.localDate} ${s.localTime}`);

describe('validateScheduleSpec', () => {
  it('rejects end before start, duplicate times, weekly without days, scheduled without times, bad tz', () => {
    expect(() => validateScheduleSpec({ ...base, endDate: '2026-09-30' })).toThrow(ValidationError);
    expect(() => validateScheduleSpec({ ...base, times: ['08:00', '08:00'] })).toThrow(ValidationError);
    expect(() => validateScheduleSpec({ ...base, frequency: 'weekly', weekdays: [] })).toThrow(ValidationError);
    expect(() => validateScheduleSpec({ ...base, times: [] })).toThrow(ValidationError);
    expect(() => validateScheduleSpec({ ...base, timezone: 'Mars/Olympus' })).toThrow(ValidationError);
    expect(() => validateScheduleSpec({ ...base, times: ['25:00'] })).toThrow(ValidationError);
  });
  it('accepts end == start (inclusive) and a future start', () => {
    expect(validateScheduleSpec({ ...base, endDate: base.startDate }).endDate).toBe('2026-10-01');
    expect(validateScheduleSpec({ ...base, startDate: '2030-01-01' }).startDate).toBe('2030-01-01');
  });
  it('none has no times and no reminders', () => {
    const s = validateScheduleSpec({ ...base, frequency: 'none', times: [], reminderEnabled: true });
    expect(s.times).toEqual([]);
    expect(s.reminderEnabled).toBe(false);
  });
});

describe('planSlots', () => {
  it('daily with multiple times, sorted', () => {
    const v = version({ times: ['20:00', '08:00'] });
    expect(keys(planSlots(v, '2026-10-01', '2026-10-02'))).toEqual(['2026-10-01 08:00', '2026-10-01 20:00', '2026-10-02 08:00', '2026-10-02 20:00']);
    expect(planSlots(v, '2026-10-01', '2026-10-01')[0]!.scheduledAt.toISOString()).toBe('2026-10-01T11:00:00.000Z');
  });

  it('weekly only on chosen weekdays', () => {
    const v = version({ frequency: 'weekly', weekdays: [1, 3] }); // Mon, Wed
    expect(keys(planSlots(v, '2026-10-01', '2026-10-10'))).toEqual(['2026-10-05 08:00', '2026-10-07 08:00']);
  });

  it('end date is inclusive', () => {
    const v = version({ endDate: '2026-10-03' });
    expect(keys(planSlots(v, '2026-10-01', '2026-10-10'))).toEqual(['2026-10-01 08:00', '2026-10-02 08:00', '2026-10-03 08:00']);
  });

  it('future start: nothing before startDate', () => {
    const v = version({ startDate: '2026-10-05' });
    expect(keys(planSlots(v, '2026-10-01', '2026-10-06'))).toEqual(['2026-10-05 08:00', '2026-10-06 08:00']);
  });

  it('none produces nothing', () => {
    expect(planSlots(version({ frequency: 'none', times: [] }), '2026-10-01', '2026-10-05')).toEqual([]);
  });

  it('first version covers the whole local day of creation but no earlier days', () => {
    const v = version({ startDate: '2026-09-01', times: ['08:00', '20:00'] }, new Date('2026-10-10T15:00:00Z')); // 12:00 in SP
    expect(keys(planSlots(v, '2026-10-08', '2026-10-10'))).toEqual(['2026-10-10 08:00', '2026-10-10 20:00']);
  });

  it('revision covers only from the confirmation instant, and effectiveUntil is exclusive', () => {
    const v = version({ startDate: '2026-09-01', times: ['08:00', '20:00'] }, new Date('2026-10-10T15:00:00Z'), false);
    expect(keys(planSlots(v, '2026-10-10', '2026-10-10'))).toEqual(['2026-10-10 20:00']);
    v.effectiveUntil = new Date('2026-10-11T23:00:00Z'); // 20:00 SP on the 11th
    expect(keys(planSlots(v, '2026-10-10', '2026-10-12'))).toEqual(['2026-10-10 20:00', '2026-10-11 08:00']);
  });

  it('is deterministic (idempotent keys)', () => {
    const v = version({ times: ['08:00', '12:00'] });
    expect(planSlots(v, '2026-10-01', '2026-10-03')).toEqual(planSlots(v, '2026-10-01', '2026-10-03'));
  });

  it('DST gap in America/New_York: 02:30 slot moves to 03:00 EDT, still one occurrence that day', () => {
    const v = version({ timezone: 'America/New_York', times: ['02:30'], startDate: '2026-03-07' }, new Date('2026-01-01T00:00:00Z'));
    const slots = planSlots(v, '2026-03-07', '2026-03-09');
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-09T06:30:00.000Z',
    ]);
    expect(slots[1]!.localTime).toBe('02:30');
  });

  it('DST overlap in America/New_York: a single 01:30 occurrence at the first instant', () => {
    const v = version({ timezone: 'America/New_York', times: ['01:30'], startDate: '2026-11-01' });
    const slots = planSlots(v, '2026-11-01', '2026-11-01');
    expect(slots).toHaveLength(1);
    expect(slots[0]!.scheduledAt.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('America/Santiago midnight dose on the DST start day → 01:00 local', () => {
    const v = version({ timezone: 'America/Santiago', times: ['00:00'], startDate: '2026-09-05' });
    const slots = planSlots(v, '2026-09-05', '2026-09-07');
    expect(slots.map((s) => s.scheduledAt.toISOString())).toEqual([
      '2026-09-05T04:00:00.000Z',
      '2026-09-06T04:00:00.000Z',
      '2026-09-07T03:00:00.000Z',
    ]);
  });

  it('Europe/Lisbon overlap → one occurrence', () => {
    const v = version({ timezone: 'Europe/Lisbon', times: ['01:30'], startDate: '2026-10-25' });
    expect(planSlots(v, '2026-10-25', '2026-10-25').map((s) => s.scheduledAt.toISOString())).toEqual(['2026-10-25T00:30:00.000Z']);
  });
});
