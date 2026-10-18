import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreateWaterEntryRequest, HydrationSummary, WaterEntry } from '@zelo/contracts';
import { Harness, fakeData } from '@/test/harness';
import { addDays, todayIn } from '@/shared/lib/time';
import { WaterForm } from '../WaterForm';
import { WaterPage } from '../WaterPage';
import { parseWaterMl } from '../waterLogic';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/saude/agua',
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const TZ = 'America/Sao_Paulo';

function summary(days: { date: string; totalMl: number | null }[], goal: number | null = null): HydrationSummary {
  return {
    timezone: TZ,
    from: days[0]!.date,
    to: days[days.length - 1]!.date,
    days: days.map((d) => ({ ...d, entryCount: d.totalMl == null ? 0 : 1 })),
    goal: goal ? { dailyTargetMl: goal, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' } : null,
    averageMlOnRecordedDays: null,
  };
}

function entryFrom(req: CreateWaterEntryRequest): WaterEntry {
  return { ...req, notes: req.notes ?? null, version: 0, createdAt: req.consumedAt, updatedAt: req.consumedAt };
}

describe('parseWaterMl', () => {
  it('accepts only positive integers', () => {
    expect(parseWaterMl('250')).toEqual({ ok: true, value: 250 });
    expect(parseWaterMl('250,5').ok).toBe(false);
    expect(parseWaterMl('2.5').ok).toBe(false);
    expect(parseWaterMl('0').ok).toBe(false);
    expect(parseWaterMl('-10').ok).toBe(false);
    expect(parseWaterMl('').ok).toBe(false);
    expect(parseWaterMl('20000').ok).toBe(false);
  });
});

describe('WaterForm', () => {
  it('rejects decimals and future instants; sends an integer amount once on double click', async () => {
    const create = vi.fn((req: CreateWaterEntryRequest) => Promise.resolve({ value: entryFrom(req), persistence: 'server' as const }));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createWaterEntry: create })}>
        <WaterForm onDone={onDone} />
      </Harness>,
    );
    const amount = screen.getByLabelText(/Quantidade/);
    await user.type(amount, '250,5');
    await user.click(screen.getByRole('button', { name: /Registrar água/ }));
    expect(screen.getByText(/número inteiro de ml/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.clear(amount);
    await user.type(amount, '350');
    const date = screen.getByLabelText(/^Data/);
    await user.clear(date);
    await user.type(date, '2099-01-01');
    await user.click(screen.getByRole('button', { name: /Registrar água/ }));
    expect(screen.getByText(/não podem estar no futuro/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.clear(date);
    await user.type(date, '2026-01-10');
    const submit = screen.getByRole('button', { name: /Registrar água/ });
    await user.click(submit);
    await user.click(submit);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ amountMl: 350, timezone: TZ });
  });
});

describe('WaterPage', () => {
  it('quick add saves immediately and "Desfazer" deletes exactly that entry (local persistence)', async () => {
    const today = todayIn(TZ);
    const create = vi.fn((req: CreateWaterEntryRequest) => Promise.resolve({ value: entryFrom(req), persistence: 'local' as const }));
    const del = vi.fn(() => Promise.resolve({ value: null, persistence: 'local' as const }));
    const data = fakeData({
      createWaterEntry: create,
      deleteWaterEntry: del,
      getHydrationSummary: vi.fn((from: string, to: string) =>
        Promise.resolve(from === to ? summary([{ date: today, totalMl: null }]) : summary([{ date: from, totalMl: null }, { date: to, totalMl: null }])),
      ),
      listWaterEntries: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    });
    const user = userEvent.setup();
    render(
      <Harness data={data}>
        <WaterPage />
      </Harness>,
    );
    await user.click(await screen.findByRole('button', { name: 'Registrar 300 ml agora' }));
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const req = create.mock.calls[0]![0];
    expect(req.amountMl).toBe(300);
    expect(await screen.findByText('+300 ml salvo neste dispositivo')).toBeInTheDocument();
    expect(screen.getAllByText(/Salvo neste dispositivo/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Desfazer' }));
    await vi.waitFor(() => expect(del).toHaveBeenCalledWith(req.id, expect.objectContaining({ expectedVersion: 0 })));
  });

  it('distinguishes a day without records from a total, shows real value above the goal', async () => {
    const today = todayIn(TZ);
    const yesterday = addDays(today, -1);
    const data = fakeData({
      getHydrationSummary: vi.fn((from: string, to: string) =>
        Promise.resolve(
          from === to
            ? summary([{ date: today, totalMl: 2400 }], 2000)
            : summary(
                Array.from({ length: 7 }, (_, i) => {
                  const date = addDays(from, i);
                  return { date, totalMl: date === yesterday ? null : date === today ? 2400 : 1000 };
                }),
                2000,
              ),
        ),
      ),
      listWaterEntries: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    });
    render(
      <Harness data={data}>
        <WaterPage />
      </Harness>,
    );
    expect(await screen.findByText('2.400')).toBeInTheDocument();
    expect(screen.getByText('120% da meta')).toBeInTheDocument();
    expect(screen.getAllByText(/Meta pessoal/).length).toBeGreaterThan(0);
    expect(screen.getByText('2.000 ml', { selector: 'strong' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { hidden: true });
    const rows = within(table).getAllByRole('row', { hidden: true });
    const absent = rows.filter((r) => r.textContent?.includes('sem registros'));
    expect(absent).toHaveLength(1);
    expect(within(table).queryByText('0 ml')).toBeNull();
  });
});
