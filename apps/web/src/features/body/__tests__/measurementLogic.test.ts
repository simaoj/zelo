import { describe, expect, it } from 'vitest';
import type { MeasurementSession } from '@zelo/contracts';
import { buildMeasurementValues, defaultRows, seriesFor } from '../measurementLogic';

describe('buildMeasurementValues', () => {
  it('omits empty fields (never sends 0) — waist only is valid', () => {
    const rows = defaultRows().map((r) => (r.type === 'waist' ? { ...r, value: '78,5' } : r));
    expect(buildMeasurementValues(rows)).toEqual({ ok: true, values: [{ type: 'waist', side: 'unspecified', valueCm: '78.5' }] });
  });
  it('requires at least one measurement', () => {
    const r = buildMeasurementValues(defaultRows());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.formError).toMatch(/pelo menos uma/);
  });
  it('keeps arm/thigh sides and forces unspecified for other types', () => {
    const rows = defaultRows().map((r) =>
      r.type === 'arm' ? { ...r, side: 'left' as const, value: '30' } : r.type === 'hip' ? { ...r, side: 'right' as const, value: '99' } : r,
    );
    const res = buildMeasurementValues(rows);
    expect(res).toEqual({
      ok: true,
      values: [
        { type: 'hip', side: 'unspecified', valueCm: '99' },
        { type: 'arm', side: 'left', valueCm: '30' },
      ],
    });
  });
  it('rejects duplicate type+side and invalid numbers', () => {
    const rows = [...defaultRows(), { key: 'arm-2', type: 'arm' as const, side: 'unspecified' as const, value: '31' }].map((r) =>
      r.key === 'arm' ? { ...r, value: '30' } : r.key === 'waist' ? { ...r, value: 'abc' } : r,
    );
    const res = buildMeasurementValues(rows);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.rowErrors['arm-2']).toBeDefined();
      expect(res.rowErrors.waist).toBeDefined();
    }
  });
});

describe('seriesFor', () => {
  const base = { version: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', timezone: 'UTC', notes: null };
  const sessions: MeasurementSession[] = [
    { ...base, id: 'a', measuredAt: '2026-10-02T10:00:00Z', values: [{ type: 'arm', side: 'left', valueCm: '30' }, { type: 'waist', side: 'unspecified', valueCm: '80' }] },
    { ...base, id: 'b', measuredAt: '2026-10-01T10:00:00Z', values: [{ type: 'arm', side: 'right', valueCm: '31' }, { type: 'abdomen', side: 'unspecified', valueCm: '90' }] },
    { ...base, id: 'c', measuredAt: '2026-10-03T10:00:00Z', values: [{ type: 'arm', side: 'left', valueCm: '29.5' }] },
  ];
  it('never mixes sides or waist/abdomen, ascending by time', () => {
    expect(seriesFor(sessions, 'arm', 'left').map((p) => p.valueCm)).toEqual(['30', '29.5']);
    expect(seriesFor(sessions, 'waist', 'unspecified').map((p) => p.valueCm)).toEqual(['80']);
  });
});
