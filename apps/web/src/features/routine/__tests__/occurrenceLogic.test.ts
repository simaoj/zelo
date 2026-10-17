import { describe, expect, it } from 'vitest';
import { effectiveState, occurrenceView } from '../occurrenceLogic';
import { buildItemPayload, emptyItemForm } from '../itemLogic';

describe('occurrence state labels', () => {
  it('maps every state to a pt-BR label with an icon', () => {
    expect(occurrenceView('scheduled')).toMatchObject({ label: 'Programado', icon: 'clock' });
    expect(occurrenceView('unrecorded')).toMatchObject({ label: 'Não registrado', icon: 'circle-dashed' });
    expect(occurrenceView('taken')).toMatchObject({ label: 'Tomado', icon: 'check' });
    expect(occurrenceView('not_taken')).toMatchObject({ label: 'Não tomado', icon: 'x' });
  });
  it('past time without decision is "Não registrado", never "Não tomado"', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(effectiveState({ state: 'scheduled', scheduledAt: '2026-10-17T08:00:00Z', intake: null }, now)).toBe('unrecorded');
    expect(effectiveState({ state: 'scheduled', scheduledAt: '2026-10-17T20:00:00Z', intake: null }, now)).toBe('scheduled');
    expect(effectiveState({ state: 'unrecorded', scheduledAt: '2026-10-17T08:00:00Z', intake: null }, now)).not.toBe('not_taken');
  });
});

describe('routine item form validation', () => {
  const base = { ...emptyItemForm('2026-10-17', 'America/Sao_Paulo'), name: ' Vitamina D ', dose: '0,5', unit: 'cápsula' };
  it('normalizes dose and trims name', () => {
    const r = buildItemPayload(base);
    expect(r.ok && r.value.dose).toBe('0.5');
    expect(r.ok && r.value.name).toBe('Vitamina D');
  });
  it('weekly requires a weekday; times must be unique; end ≥ start', () => {
    const r = buildItemPayload({ ...base, frequency: 'weekly', weekdays: [], times: ['08:00', '08:00'], endDate: '2026-10-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.weekdays).toBeDefined();
      expect(r.errors.times).toBeDefined();
      expect(r.errors.endDate).toBeDefined();
    }
  });
  it('"sem programação" sends no times', () => {
    const r = buildItemPayload({ ...base, frequency: 'none', times: ['08:00'] });
    expect(r.ok && r.value.schedule.times).toEqual([]);
  });
});
