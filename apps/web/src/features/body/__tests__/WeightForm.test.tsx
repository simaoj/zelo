import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreateWeightRequest } from '@zelo/contracts';
import { Harness, fakeData } from '@/test/harness';
import { WeightForm } from '../WeightForm';

describe('WeightForm', () => {
  it('accepts "82,35" and sends "82.35"; double click does not duplicate', async () => {
    let resolve: (v: unknown) => void = () => {};
    const create = vi.fn((req: CreateWeightRequest) => new Promise((r) => (resolve = () => r({ value: { ...req, version: 0, deltaKg: null }, persistence: 'local' }))));
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createWeight: create as never })}>
        <WeightForm onDone={onDone} />
      </Harness>,
    );
    await user.type(screen.getByLabelText(/Peso \(kg\)/), '82,35');
    const submit = screen.getByRole('button', { name: /Salvar registro/ });
    await user.click(submit);
    await user.click(submit);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ weightKg: '82.35', timezone: 'America/Sao_Paulo' });
    resolve(undefined);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ persistence: 'local' })));
  });

  it('rejects future instants', async () => {
    const create = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createWeight: create })}>
        <WeightForm onDone={() => {}} />
      </Harness>,
    );
    await user.type(screen.getByLabelText(/Peso \(kg\)/), '80');
    const date = screen.getByLabelText(/^Data/);
    await user.clear(date);
    await user.type(date, '2099-01-01');
    await user.click(screen.getByRole('button', { name: /Salvar registro/ }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText(/não podem estar no futuro/)).toBeInTheDocument();
  });
});
