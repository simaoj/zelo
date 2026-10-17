import { describe, expect, it } from 'vitest';
import { ConfirmationRequiredError, ValidationError } from '../../../shared/domain/errors.js';
import { changeBloodPressureEntry, createBloodPressureEntry } from './entities/blood-pressure-entry.js';

const now = new Date('2026-10-17T12:00:00Z');
const base = { id: 'x', userId: 'u', measuredAt: new Date('2026-10-17T08:00:00Z'), timezone: 'America/Sao_Paulo' };

describe('blood pressure entry', () => {
  it('pulse is optional (null, never zero)', () => {
    expect(createBloodPressureEntry({ ...base, systolic: 120, diastolic: 80, pulseBpm: null }, now).pulseBpm).toBeNull();
  });
  it('diastolic >= systolic asks for confirmation; confirmed is accepted', () => {
    expect(() => createBloodPressureEntry({ ...base, systolic: 80, diastolic: 80, pulseBpm: null }, now)).toThrow(ConfirmationRequiredError);
    expect(createBloodPressureEntry({ ...base, systolic: 80, diastolic: 90, pulseBpm: null, confirmedUnusual: true }, now).diastolic).toBe(90);
  });
  it('integers only, positive', () => {
    expect(() => createBloodPressureEntry({ ...base, systolic: 120.5, diastolic: 80, pulseBpm: null }, now)).toThrow(ValidationError);
    expect(() => createBloodPressureEntry({ ...base, systolic: 120, diastolic: 80, pulseBpm: 0 }, now)).toThrow(ValidationError);
  });
  it('edit re-checks plausibility against merged values', () => {
    const e = createBloodPressureEntry({ ...base, systolic: 120, diastolic: 80, pulseBpm: 60 }, now);
    expect(() => changeBloodPressureEntry(e, { systolic: 79 }, now)).toThrow(ConfirmationRequiredError);
    expect(changeBloodPressureEntry(e, { pulseBpm: null }, now)).toMatchObject({ pulseBpm: null, version: 1 });
  });
});
