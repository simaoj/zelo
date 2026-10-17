// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Occurrence, WeightEntry } from '@zelo/contracts';
import { composeDashboard, deriveOccurrenceState, localDateIn, pageLocal, subtractDecimal, withDeltas } from '../local-queries';

const w = (id: string, measuredAt: string, weightKg: string): WeightEntry => ({
  id, measuredAt, weightKg, version: 1, createdAt: measuredAt, updatedAt: measuredAt, timezone: 'America/Sao_Paulo', notes: null, deltaKg: null,
});

describe('local queries', () => {
  it('computes exact deltas in chronological order', () => {
    expect(subtractDecimal('82.35', '82.4')).toBe('-0.05');
    expect(subtractDecimal('80', '79.5')).toBe('0.5');
    const out = withDeltas([w('b', '2026-10-02T00:00:00Z', '81.9'), w('a', '2026-10-01T00:00:00Z', '82.35')]);
    expect(Object.fromEntries(out.map((e) => [e.id, e.deltaKg]))).toEqual({ a: null, b: '-0.45' });
  });

  it('pages desc with [from, to) and an opaque cursor', () => {
    const items = Array.from({ length: 5 }, (_, i) => w(`id${i}`, `2026-10-0${i + 1}T00:00:00.000Z`, '80'));
    const p1 = pageLocal(items, { limit: 2 });
    expect(p1.items.map((i) => i.id)).toEqual(['id4', 'id3']);
    const p2 = pageLocal(items, { limit: 2, cursor: p1.nextCursor! });
    expect(p2.items.map((i) => i.id)).toEqual(['id2', 'id1']);
    const p3 = pageLocal(items, { limit: 2, cursor: p2.nextCursor! });
    expect(p3).toEqual({ items: [items[0]], nextCursor: null });
    expect(pageLocal(items, { from: '2026-10-02T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z' }).items.map((i) => i.id)).toEqual(['id2', 'id1']);
  });

  it('derives occurrence state without ever converting absence to not_taken', () => {
    const o = { scheduledAt: '2026-10-17T10:00:00.000Z', intake: null } as Occurrence;
    expect(deriveOccurrenceState(o, new Date('2026-10-17T09:00:00Z'))).toBe('scheduled');
    expect(deriveOccurrenceState(o, new Date('2026-12-17T09:00:00Z'))).toBe('unrecorded');
  });

  it('composes the dashboard like the server', () => {
    expect(localDateIn('America/Sao_Paulo', new Date('2026-10-17T02:00:00Z'))).toBe('2026-10-16');
    const d = composeDashboard({
      date: '2026-10-17',
      profile: { userId: 'u', displayName: 'Ana', timezone: 'America/Sao_Paulo', visibleModules: [], remindersEnabled: true, version: 1, updatedAt: '' },
      weights: [w('a', '2026-10-01T00:00:00Z', '82'), w('b', '2026-10-05T00:00:00Z', '81.5')],
      bloodPressure: [],
      measurements: [],
      occurrences: [],
      now: new Date('2026-10-17T12:00:00Z'),
    });
    expect(d.latestWeight).toMatchObject({ id: 'b', deltaKg: '-0.5' });
    expect(d.weightSparkline.map((s) => s.weightKg)).toEqual(['82', '81.5']);
    expect(d.displayName).toBe('Ana');
  });
});
