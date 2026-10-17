import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../shared/domain/errors.js';
import { deriveState, selectFuturePending } from '../entities/occurrence.js';
import { editIntake, newIntake, replaceDecision, softDelete } from '../entities/intake-record.js';
import { canonicalDose } from '../value-objects/dose.js';
import { createRoutineItem, editRoutineItem, archiveRoutineItem } from '../entities/routine-item.js';

const now = new Date('2026-10-17T12:00:00Z');
const snap = { nameSnapshot: 'Losartana', doseSnapshot: '50', unitSnapshot: 'mg' };

describe('deriveState', () => {
  it('scheduled / unrecorded / decisions', () => {
    expect(deriveState({ scheduledAt: new Date('2026-10-17T13:00:00Z') }, null, now)).toBe('scheduled');
    expect(deriveState({ scheduledAt: new Date('2026-10-17T11:00:00Z') }, null, now)).toBe('unrecorded');
    expect(deriveState({ scheduledAt: new Date('2026-10-17T11:00:00Z') }, { status: 'taken' }, now)).toBe('taken');
    expect(deriveState({ scheduledAt: new Date('2026-10-17T13:00:00Z') }, { status: 'not_taken' }, now)).toBe('not_taken');
  });
  it('unrecorded never becomes not_taken with time', () => {
    const occ = { scheduledAt: new Date('2020-01-01T00:00:00Z') };
    expect(deriveState(occ, null, new Date('2030-01-01T00:00:00Z'))).toBe('unrecorded');
  });
});

describe('selectFuturePending', () => {
  it('keeps past and decided occurrences', () => {
    const occ = (id: string, iso: string) => ({ id, scheduledAt: new Date(iso), cancelledAt: null });
    const list = [occ('past', '2026-10-17T10:00:00Z'), occ('future', '2026-10-17T20:00:00Z'), occ('decided', '2026-10-17T21:00:00Z')];
    expect(selectFuturePending(list, new Set(['decided']), now).map((o) => o.id)).toEqual(['future']);
  });
});

describe('intake rules', () => {
  const base = { id: 'r1', userId: 'u', itemId: 'i', occurrenceId: 'o', snapshot: snap, scheduledAt: new Date('2026-10-17T11:00:00Z'), now };

  it('taken requires actualTakenAt, never in the future', () => {
    expect(() => newIntake({ ...base, status: 'taken', actualTakenAt: null })).toThrow(ValidationError);
    expect(() => newIntake({ ...base, status: 'taken', actualTakenAt: new Date('2026-10-17T13:00:00Z') })).toThrow(ValidationError);
    const r = newIntake({ ...base, status: 'taken', actualTakenAt: new Date('2026-10-16T09:00:00Z') });
    expect(r.actualTakenAt?.toISOString()).toBe('2026-10-16T09:00:00.000Z');
    expect(r.sortAt).toEqual(r.actualTakenAt);
  });

  it('not_taken clears actualTakenAt and sorts by scheduled time', () => {
    const r = newIntake({ ...base, status: 'not_taken', actualTakenAt: now });
    expect(r.actualTakenAt).toBeNull();
    expect(r.sortAt).toEqual(base.scheduledAt);
  });

  it('replace keeps snapshots and bumps version; edit time only for taken', () => {
    const r = newIntake({ ...base, status: 'not_taken', actualTakenAt: null });
    const replaced = replaceDecision(r, { status: 'taken', actualTakenAt: now, scheduledAt: base.scheduledAt }, now);
    expect(replaced.version).toBe(1);
    expect(replaced.nameSnapshot).toBe('Losartana');
    expect(() => editIntake(r, { actualTakenAt: now }, now)).toThrow(ValidationError);
    expect(editIntake(replaced, { notes: '  com água ' }, now).notes).toBe('com água');
  });

  it('notes ≤ 1000', () => {
    expect(() => newIntake({ ...base, status: 'not_taken', actualTakenAt: null, notes: 'x'.repeat(1001) })).toThrow(ValidationError);
  });

  it('soft delete', () => {
    const r = softDelete(newIntake({ ...base, status: 'not_taken', actualTakenAt: null }), now);
    expect(r.deletedAt).toEqual(now);
    expect(r.version).toBe(1);
  });
});

describe('routine item + dose', () => {
  it('canonical dose ≤ 3 decimals, positive', () => {
    expect(canonicalDose('1.500')).toBe('1.5');
    expect(canonicalDose('0,25')).toBe('0.25');
    expect(canonicalDose('010')).toBe('10');
    expect(() => canonicalDose('0')).toThrow(ValidationError);
    expect(() => canonicalDose('1.2345')).toThrow(ValidationError);
    expect(() => canonicalDose('-1')).toThrow(ValidationError);
  });

  it('name trimmed ≤120, unit required, archive twice fails', () => {
    const item = createRoutineItem({ id: 'i', userId: 'u', name: '  Vitamina D ', type: 'vitamin', dose: '2', unit: ' gotas ', now });
    expect(item.name).toBe('Vitamina D');
    expect(item.currentUnit).toBe('gotas');
    expect(() => createRoutineItem({ id: 'i', userId: 'u', name: ' ', type: 'vitamin', dose: '2', unit: 'x', now })).toThrow(ValidationError);
    expect(() => createRoutineItem({ id: 'i', userId: 'u', name: 'x'.repeat(121), type: 'vitamin', dose: '2', unit: 'x', now })).toThrow(ValidationError);
    expect(() => createRoutineItem({ id: 'i', userId: 'u', name: 'x', type: 'vitamin', dose: '2', unit: '  ', now })).toThrow(ValidationError);
    expect(editRoutineItem(item, { name: 'D3' }, now).version).toBe(1);
    const archived = archiveRoutineItem(item, now);
    expect(() => archiveRoutineItem(archived, now)).toThrow(ValidationError);
  });
});
