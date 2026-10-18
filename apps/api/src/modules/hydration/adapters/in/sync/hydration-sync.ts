import { CreateWaterEntryRequest, DeleteRequest, UpdateWaterEntryRequest } from '@zelo/contracts';
import type { z } from 'zod';
import type { SyncOperationHandler, SyncReader } from '../../../../../bootstrap/module-contract.js';
import type { Clock } from '../../../../../shared/application/ports.js';
import { ValidationError } from '../../../../../shared/domain/errors.js';
import { toWaterEntryDto } from '../../../application/dto.js';
import type { TimezoneProvider, WaterEntryRepository } from '../../../application/ports/index.js';
import { bootstrapWindowStart, type HydrationUseCases } from '../../../application/use-cases/index.js';
import { WATER_OPS } from '../http/hydration-routes.js';

function parsePayload<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const r = schema.safeParse(payload);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of r.error.issues) (fieldErrors[i.path.join('.') || '_'] ??= []).push(i.message);
    throw new ValidationError('Confira os campos informados.', fieldErrors);
  }
  return r.data;
}

/** Offline operations: call the SAME use cases as REST (same op type names → cross-replay). */
export function hydrationSyncHandlers(uc: HydrationUseCases): SyncOperationHandler[] {
  return [
    {
      type: WATER_OPS.create,
      async handle(actor, entityId, payload, tx) {
        const p = parsePayload(CreateWaterEntryRequest, payload);
        if (entityId !== p.id) throw new ValidationError('entityId diferente do id do registro', { id: ['Deve ser igual a entityId'] });
        return { status: 201, body: await uc.registerWaterIntake.execute(actor, p, tx) };
      },
    },
    {
      type: WATER_OPS.update,
      async handle(actor, entityId, payload, tx) {
        return { status: 200, body: await uc.updateWaterIntake.execute(actor, entityId, parsePayload(UpdateWaterEntryRequest, payload), tx) };
      },
    },
    {
      type: WATER_OPS.delete,
      async handle(actor, entityId, payload, tx) {
        await uc.deleteWaterIntake.execute(actor, entityId, parsePayload(DeleteRequest, payload).expectedVersion, tx);
        return { status: 204, body: null };
      },
    },
  ];
}

export function hydrationSyncReaders(d: { entries: WaterEntryRepository; uc: HydrationUseCases; clock: Clock; timezones: TimezoneProvider }): SyncReader[] {
  return [
    {
      entity: 'waterEntry',
      async getById(userId, id, tx) {
        const e = await d.entries.findById(userId, id, tx);
        return e && !e.deletedAt ? toWaterEntryDto(e) : null;
      },
      async listForBootstrap(userId, tx) {
        const from = await bootstrapWindowStart(userId, d.clock, d.timezones);
        return (await d.entries.listLiveBetween(userId, from, null, tx)).map(toWaterEntryDto);
      },
    },
    {
      entity: 'hydrationGoal',
      async getById(userId, id, tx) {
        if (id !== userId) return null;
        return d.uc.hydrationGoal.find(userId, tx);
      },
      async listForBootstrap(userId, tx) {
        const g = await d.uc.hydrationGoal.find(userId, tx);
        return g ? [g] : [];
      },
    },
  ];
}
