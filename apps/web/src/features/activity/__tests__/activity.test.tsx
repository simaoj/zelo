import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActivityToday, StepsSummary } from '@zelo/contracts';
import { Harness, fakeData } from '@/test/harness';
import { addDays, todayIn } from '@/shared/lib/time';
import { StepsPage } from '../StepsPage';
import { ActivitySummaryPage } from '../ActivitySummaryPage';
import { ACTIVITY_EMPTY_TEXT, ACTIVITY_EMPTY_TITLE, stepsDayStatus } from '../activityLogic';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/atividade/passos',
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const TZ = 'America/Sao_Paulo';

describe('stepsDayStatus', () => {
  it('distinguishes absent, reported zero and partial', () => {
    expect(stepsDayStatus({ count: null, partial: false }).text).toBe('Sem dados');
    expect(stepsDayStatus({ count: 0, partial: false }).text).toBe('0 passos informados');
    expect(stepsDayStatus({ count: 6842, partial: true })).toMatchObject({ text: '6.842 passos', partial: true });
  });
});

describe('StepsPage', () => {
  it('renders "Sem dados", "0 passos informados" and "Parcial (hoje)" per day', async () => {
    const today = todayIn(TZ);
    const from = addDays(today, -6);
    const s: StepsSummary = {
      from,
      to: today,
      days: Array.from({ length: 7 }, (_, i) => {
        const date = addDays(from, i);
        const count = date === today ? 4200 : i === 0 ? 0 : i === 1 ? 8000 : null;
        return { date, count, partial: date === today, receivedAt: count == null ? null : '2026-10-18T17:30:00.000Z' };
      }),
      goal: null,
      averageOnDaysWithData: 4067,
      lastReceivedAt: '2026-10-18T17:30:00.000Z',
    };
    render(
      <Harness data={fakeData({ getStepsSummary: vi.fn(() => Promise.resolve(s)) })}>
        <StepsPage />
      </Harness>,
    );
    expect(await screen.findByText('0 passos informados')).toBeInTheDocument();
    expect(screen.getAllByText('Sem dados')).toHaveLength(4);
    expect(screen.getByText('Parcial (hoje)')).toBeInTheDocument();
    expect(screen.getAllByText('4.200 passos').length).toBeGreaterThan(0);
    expect(screen.getByText(/Média nos dias com dados/)).toHaveTextContent('4.067 passos');
    // no manual edit of steps
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
    expect(screen.queryByText(/importar|sincronizar/i)).toBeNull();
  });
});

describe('ActivitySummaryPage', () => {
  it('shows the exact empty state when nothing was received', async () => {
    const today = todayIn(TZ);
    const a: ActivityToday = {
      date: today,
      steps: { date: today, count: null, partial: true, receivedAt: null },
      stepsGoal: null,
      workoutCount: 0,
      workoutSeconds: 0,
      lastReceivedAt: null,
    };
    render(
      <Harness data={fakeData({ getActivityToday: vi.fn(() => Promise.resolve(a)), listWorkouts: vi.fn(() => Promise.resolve({ items: [], nextCursor: null, availableNames: [] })) })}>
        <ActivitySummaryPage />
      </Harness>,
    );
    expect(await screen.findByText(ACTIVITY_EMPTY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(ACTIVITY_EMPTY_TEXT)).toBeInTheDocument();
    expect(ACTIVITY_EMPTY_TITLE).toBe('Nenhum dado de atividade recebido ainda.');
    expect(ACTIVITY_EMPTY_TEXT).toBe('Seus passos e exercícios aparecerão aqui após o recebimento dos dados do Auto Export.');
  });

  it('shows steps vs goal, workout time and when data was received', async () => {
    const today = todayIn(TZ);
    const a: ActivityToday = {
      date: today,
      steps: { date: today, count: 6420, partial: true, receivedAt: '2026-10-18T17:30:00.000Z' },
      stepsGoal: { dailyStepsTarget: 8000, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' },
      workoutCount: 1,
      workoutSeconds: 3900,
      lastReceivedAt: '2026-10-18T17:30:00.000Z',
    };
    render(
      <Harness data={fakeData({ getActivityToday: vi.fn(() => Promise.resolve(a)), listWorkouts: vi.fn(() => Promise.resolve({ items: [], nextCursor: null, availableNames: [] })) })}>
        <ActivitySummaryPage />
      </Harness>,
    );
    expect(await screen.findByText('6.420')).toBeInTheDocument();
    expect(screen.getByText('80% da meta pessoal')).toBeInTheDocument();
    expect(screen.getByText('1 h 05 min')).toBeInTheDocument();
    expect(screen.getByText(/Dados recebidos/)).toHaveTextContent(/Parcial do dia/);
  });
});
