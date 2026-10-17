import { CreateMeasurementRequest, CreateWeightRequest, DeleteRequest, UpdateMeasurementRequest, UpdateWeightRequest } from '@zelo/contracts';
import type { z } from 'zod';
import type { SyncOperationHandler, SyncReader } from '../../../../../bootstrap/module-contract.js';
import { ValidationError } from '../../../../../shared/domain/errors.js';
import { toMeasurementDto, toWeightGoalDto } from '../../../application/dto.js';
import type { MeasurementRepository, WeightGoalRepository, WeightRepository } from '../../../application/ports/out/index.js';
import type { BodyUseCases } from '../../../application/use-cases/index.js';
import { deltasFor } from '../../../domain/entities/weight-entry.js';
import { toWeightDto } from '../../../application/dto.js';

export function parsePayload<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const r = schema.safeParse(payload);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of r.error.issues) (fieldErrors[i.path.join('.') || '_'] ??= []).push(i.message);
    throw new ValidationError('Confira os campos informados.', fieldErrors);
  }
  return r.data;
}

function sameId(entityId: string, id: string) {
  if (entityId !== id) throw new ValidationError('entityId diferente do id do registro', { id: ['Deve ser igual a entityId'] });
}

export function bodySyncHandlers(uc: BodyUseCases): SyncOperationHandler[] {
  return [
    {
      type: 'weight.create',
      async handle(actor, entityId, payload, tx) {
        const p = parsePayload(CreateWeightRequest, payload);
        sameId(entityId, p.id);
        return { status: 201, body: await uc.registerWeight.execute(actor, p, tx) };
      },
    },
    {
      type: 'weight.update',
      async handle(actor, entityId, payload, tx) {
        return { status: 200, body: await uc.updateWeight.execute(actor, entityId, parsePayload(UpdateWeightRequest, payload), tx) };
      },
    },
    {
      type: 'weight.delete',
      async handle(actor, entityId, payload, tx) {
        await uc.deleteWeight.execute(actor, entityId, parsePayload(DeleteRequest, payload).expectedVersion, tx);
        return { status: 204, body: null };
      },
    },
    {
      type: 'measurement.create',
      async handle(actor, entityId, payload, tx) {
        const p = parsePayload(CreateMeasurementRequest, payload);
        sameId(entityId, p.id);
        return { status: 201, body: await uc.registerMeasurements.execute(actor, p, tx) };
      },
    },
    {
      type: 'measurement.update',
      async handle(actor, entityId, payload, tx) {
        return { status: 200, body: await uc.updateMeasurements.execute(actor, entityId, parsePayload(UpdateMeasurementRequest, payload), tx) };
      },
    },
    {
      type: 'measurement.delete',
      async handle(actor, entityId, payload, tx) {
        await uc.deleteMeasurements.execute(actor, entityId, parsePayload(DeleteRequest, payload).expectedVersion, tx);
        return { status: 204, body: null };
      },
    },
  ];
}

export function bodySyncReaders(d: { weights: WeightRepository; goals: WeightGoalRepository; measurements: MeasurementRepository; uc: BodyUseCases }): SyncReader[] {
  return [
    {
      entity: 'weightEntry',
      async getById(userId, id, tx) {
        const e = await d.weights.findById(userId, id, tx);
        return e && !e.deletedAt ? d.uc.presenter.present(e, tx) : null;
      },
      async listForBootstrap(userId, tx) {
        const all = await d.weights.listLive(userId, tx);
        const deltas = deltasFor(all);
        return all.map((e) => toWeightDto(e, deltas.get(e.id) ?? null));
      },
    },
    {
      entity: 'weightGoal',
      async getById(userId, id, tx) {
        if (id !== userId) return null;
        const g = await d.goals.findActive(userId, tx);
        return g ? toWeightGoalDto(g) : null;
      },
      async listForBootstrap(userId, tx) {
        const g = await d.goals.findActive(userId, tx);
        return g ? [toWeightGoalDto(g)] : [];
      },
    },
    {
      entity: 'measurementSession',
      async getById(userId, id, tx) {
        const s = await d.measurements.findById(userId, id, tx);
        return s && !s.deletedAt ? toMeasurementDto(s) : null;
      },
      async listForBootstrap(userId, tx) {
        return (await d.measurements.listLive(userId, tx)).map(toMeasurementDto);
      },
    },
  ];
}
