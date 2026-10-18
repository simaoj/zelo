import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatInt, formatMl, formatReceivedAt, formatSteps, modalityLabel, percentOf } from '../format';

describe('pt-BR formatting', () => {
  it('formats integers and ml with thousands separator', () => {
    expect(formatInt(1400)).toBe('1.400');
    expect(formatMl(2400)).toBe('2.400 ml');
    expect(formatSteps(6842)).toBe('6.842 passos');
    expect(formatSteps(0)).toBe('0 passos');
  });

  it('formats durations', () => {
    expect(formatDuration(1800)).toBe('30 min');
    expect(formatDuration(2100)).toBe('35 min');
    expect(formatDuration(3900)).toBe('1 h 05 min');
    expect(formatDuration(7200)).toBe('2 h');
    expect(formatDuration(42)).toBe('42 s');
  });

  it('formats distance in km with comma decimal', () => {
    expect(formatDistance(4200)).toBe('4,2 km');
    expect(formatDistance(10000)).toBe('10 km');
    expect(formatDistance(850)).toBe('0,85 km');
  });

  it('keeps percentages above 100 (no cap)', () => {
    expect(percentOf(2400, 2000)).toBe(120);
    expect(percentOf(1400, 2000)).toBe(70);
  });

  it('describes when data was received', () => {
    const now = new Date('2026-10-18T20:00:00.000Z');
    expect(formatReceivedAt('2026-10-18T17:30:00.000Z', 'America/Sao_Paulo', now)).toBe('hoje às 14:30');
    expect(formatReceivedAt('2026-10-12T17:30:00.000Z', 'America/Sao_Paulo', now)).toBe('12/10 às 14:30');
  });

  it('translates common workout names and falls back to the original', () => {
    expect(modalityLabel('Running')).toBe('Corrida');
    expect(modalityLabel('Walking')).toBe('Caminhada');
    expect(modalityLabel('Cycling')).toBe('Ciclismo');
    expect(modalityLabel('Swimming')).toBe('Natação');
    expect(modalityLabel('Yoga')).toBe('Yoga');
    expect(modalityLabel('Strength Training')).toBe('Treino de força');
    expect(modalityLabel('Curling')).toBe('Curling');
  });
});
