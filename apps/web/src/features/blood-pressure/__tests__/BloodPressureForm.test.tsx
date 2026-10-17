import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BloodPressureEntry, CreateBloodPressureRequest } from '@zelo/contracts';
import { DataError } from '@/shared/data/ports';
import { Harness, fakeData } from '@/test/harness';
import { BloodPressureForm } from '../BloodPressureForm';

function entryFrom(req: CreateBloodPressureRequest): BloodPressureEntry {
  return {
    id: req.id,
    version: 0,
    createdAt: req.measuredAt,
    updatedAt: req.measuredAt,
    measuredAt: req.measuredAt,
    timezone: req.timezone,
    systolic: req.systolic,
    diastolic: req.diastolic,
    pulseBpm: req.pulseBpm,
    notes: req.notes ?? null,
  };
}

async function fill(user: ReturnType<typeof userEvent.setup>, s: string, d: string, p = '') {
  await user.type(screen.getByLabelText(/Sistólica/), s);
  await user.type(screen.getByLabelText(/Diastólica/), d);
  if (p) await user.type(screen.getByLabelText(/Pulso/), p);
}

describe('BloodPressureForm', () => {
  it('sends empty pulse as null', async () => {
    const create = vi.fn(async (req: CreateBloodPressureRequest) => ({ value: entryFrom(req), persistence: 'server' as const }));
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createBloodPressure: create })}>
        <BloodPressureForm onDone={() => {}} />
      </Harness>,
    );
    await fill(user, '120', '80');
    await user.click(screen.getByRole('button', { name: /Registrar pressão/ }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ systolic: 120, diastolic: 80, pulseBpm: null, timezone: 'America/Sao_Paulo' });
    expect(create.mock.calls[0]![0]).not.toHaveProperty('confirmedUnusual');
  });

  it('asks for confirmation when diastolic >= systolic, then resends with confirmedUnusual', async () => {
    const create = vi.fn(async (req: CreateBloodPressureRequest) => ({ value: entryFrom(req), persistence: 'server' as const }));
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createBloodPressure: create })}>
        <BloodPressureForm onDone={() => {}} />
      </Harness>,
    );
    await fill(user, '80', '90', '70');
    await user.click(screen.getByRole('button', { name: /Registrar pressão/ }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByText('Confira os valores')).toBeInTheDocument();
    expect(screen.queryByText(/hipertens|hipotens|diagn/i)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Os valores estão corretos' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({ systolic: 80, diastolic: 90, pulseBpm: 70, confirmedUnusual: true });
  });

  it('handles server 422 CONFIRMATION_REQUIRED and retries with a new operationId', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new DataError(422, { code: 'CONFIRMATION_REQUIRED', message: 'Confirme', correlationId: 'x' }))
      .mockImplementationOnce(async (req: CreateBloodPressureRequest) => ({ value: entryFrom(req), persistence: 'server' as const }));
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createBloodPressure: create })}>
        <BloodPressureForm onDone={() => {}} />
      </Harness>,
    );
    await fill(user, '120', '80');
    await user.click(screen.getByRole('button', { name: /Registrar pressão/ }));
    await user.click(await screen.findByRole('button', { name: 'Os valores estão corretos' }));
    expect(create).toHaveBeenCalledTimes(2);
    const [first, second] = [create.mock.calls[0]![0], create.mock.calls[1]![0]];
    expect(second.confirmedUnusual).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.operationId).not.toBe(first.operationId);
  });

  it('preserves fields and shows validation errors', async () => {
    const create = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness data={fakeData({ createBloodPressure: create })}>
        <BloodPressureForm onDone={() => {}} />
      </Harness>,
    );
    await user.type(screen.getByLabelText(/Sistólica/), '12a');
    await user.click(screen.getByRole('button', { name: /Registrar pressão/ }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Sistólica/)).toHaveValue('12a');
    expect(screen.getByText('Informe a diastólica')).toBeInTheDocument();
  });
});
