import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/domain/errors.js';
import { canonical, compare, positiveDecimal, subtract } from './value-objects/decimal.js';
import { changeWeightEntry, createWeightEntry, deltasFor, type WeightEntry } from './entities/weight-entry.js';
import { createMeasurementSession, validateValues, valueOf } from './entities/measurement-session.js';

const now = new Date('2026-10-17T12:00:00Z');

describe('decimal value object', () => {
  it('keeps exact precision (82.35 never becomes 82.34999…)', () => {
    expect(positiveDecimal('82.35', 2, 'w')).toBe('82.35');
    expect(positiveDecimal('82,35', 2, 'w')).toBe('82.35');
    expect(subtract('82.35', '82.3')).toBe('0.05');
    expect(subtract('0.1', '0.3')).toBe('-0.2');
    expect(subtract('80', '80.00')).toBe('0');
    expect(compare('10.5', '10.50')).toBe(0);
    expect(canonical('007.500')).toBe('7.5');
  });
  it('rejects zero, negatives and excess scale', () => {
    expect(() => positiveDecimal('0', 2, 'w')).toThrow(ValidationError);
    expect(() => positiveDecimal('-1', 2, 'w')).toThrow(ValidationError);
    expect(() => positiveDecimal('1.234', 2, 'w')).toThrow(ValidationError);
    expect(() => positiveDecimal('1e3', 2, 'w')).toThrow(ValidationError);
  });
});

describe('weight entry', () => {
  const mk = (id: string, iso: string, kg: string): WeightEntry =>
    createWeightEntry({ id, userId: 'u', measuredAt: new Date(iso), timezone: 'America/Sao_Paulo', weightKg: kg }, now);

  it('rejects future instants (beyond small skew)', () => {
    expect(() => mk('a', '2026-10-17T13:00:00Z', '80')).toThrow(ValidationError);
    expect(() => mk('a', '2026-10-17T12:00:30Z', '80')).not.toThrow();
  });

  it('delta follows chronological order, not insertion order; ties broken by id', () => {
    const entries = [mk('c', '2026-10-02T08:00:00Z', '80.1'), mk('a', '2026-10-01T08:00:00Z', '80.5'), mk('b', '2026-10-02T08:00:00Z', '80.3')];
    const d = deltasFor(entries);
    expect(d.get('a')).toBeNull();
    expect(d.get('b')).toBe('-0.2');
    expect(d.get('c')).toBe('-0.2');
  });

  it('ignores deleted entries for deltas', () => {
    const a = mk('a', '2026-10-01T08:00:00Z', '80');
    const b = { ...mk('b', '2026-10-02T08:00:00Z', '81'), deletedAt: now };
    const c = mk('c', '2026-10-03T08:00:00Z', '79.5');
    expect(deltasFor([a, b, c]).get('c')).toBe('-0.5');
  });

  it('change bumps version and keeps unspecified fields', () => {
    const e = mk('a', '2026-10-01T08:00:00Z', '80');
    const n = changeWeightEntry(e, { notes: '  em jejum ' }, now);
    expect(n).toMatchObject({ version: 1, weightKg: '80', notes: 'em jejum' });
  });
});

describe('measurement session', () => {
  it('waist-only is valid and nothing else is filled', () => {
    const s = createMeasurementSession({ id: 's', userId: 'u', measuredAt: new Date('2026-10-01T00:00:00Z'), timezone: 'UTC', values: [{ type: 'waist', side: 'unspecified', valueCm: '80.0' }] }, now);
    expect(s.values).toEqual([{ type: 'waist', side: 'unspecified', valueCm: '80' }]);
    expect(valueOf(s, 'abdomen', 'unspecified')).toBeUndefined();
  });
  it('only arm/thigh accept sides; type+side unique; at least one', () => {
    expect(validateValues([{ type: 'thigh', side: 'left', valueCm: '50' }, { type: 'thigh', side: 'right', valueCm: '51' }])).toHaveLength(2);
    expect(() => validateValues([{ type: 'hip', side: 'right', valueCm: '50' }])).toThrow(ValidationError);
    expect(() => validateValues([{ type: 'arm', side: 'left', valueCm: '30' }, { type: 'arm', side: 'left', valueCm: '31' }])).toThrow(ValidationError);
    expect(() => validateValues([])).toThrow(ValidationError);
    expect(() => validateValues([{ type: 'waist', side: 'unspecified', valueCm: '0' }])).toThrow(ValidationError);
  });
  it('comparison is per type AND side', () => {
    const s = createMeasurementSession({ id: 's', userId: 'u', measuredAt: new Date('2026-10-01T00:00:00Z'), timezone: 'UTC', values: [{ type: 'arm', side: 'left', valueCm: '30' }] }, now);
    expect(valueOf(s, 'arm', 'left')).toBe('30');
    expect(valueOf(s, 'arm', 'right')).toBeUndefined();
    expect(valueOf(s, 'arm', 'unspecified')).toBeUndefined();
  });
});
