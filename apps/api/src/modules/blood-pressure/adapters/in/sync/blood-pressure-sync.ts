import { CreateBloodPressureRequest, DeleteRequest, UpdateBloodPressureRequest } from '@zelo/contracts';
import type { z } from 'zod';
import type { SyncOperationHandler, SyncReader } from '../../../../../bootstrap/module-contract.js';
import { ValidationError } from '../../../../../shared/domain/errors.js';
import { toBloodPressureDto } from '../../../application/dto.js';
import type { BloodPressureRepository } from '../../../application/ports/out/blood-pressure-repository.js';
import type { BloodPressureUseCases } from '../../../application/use-cases/blood-pressure.js';

function parse<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const r = schema.safeParse(payload);
  if (!r.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of r.error.issues) (fieldErrors[i.path.join('.') || '_'] ??= []).push(i.message);
    throw new ValidationError('Confira os campos informados.', fieldErrors);
  }
  return r.data;
}

export function bloodPressureSyncHandlers(uc: BloodPressureUseCases): SyncOperationHandler[] {
  return [
    {
      type: 'bloodPressure.create',
      async handle(actor, entityId, payload, tx) {
        const p = parse(CreateBloodPressureRequest, payload);
        if (p.id !== entityId) throw new ValidationError('entityId diferente do id do registro', { id: ['Deve ser igual a entityId'] });
        return { status: 201, body: await uc.register.execute(actor, p, tx) };
      },
    },
    {
      type: 'bloodPressure.update',
      async handle(actor, entityId, payload, tx) {
        return { status: 200, body: await uc.update.execute(actor, entityId, parse(UpdateBloodPressureRequest, payload), tx) };
      },
    },
    {
      type: 'bloodPressure.delete',
      async handle(actor, entityId, payload, tx) {
        await uc.remove.execute(actor, entityId, parse(DeleteRequest, payload).expectedVersion, tx);
        return { status: 204, body: null };
      },
    },
  ];
}

export function bloodPressureSyncReader(repo: BloodPressureRepository): SyncReader {
  return {
    entity: 'bloodPressureEntry',
    async getById(userId, id, tx) {
      const e = await repo.findById(userId, id, tx);
      return e && !e.deletedAt ? toBloodPressureDto(e) : null;
    },
    async listForBootstrap(userId, tx) {
      return (await repo.listLive(userId, tx)).map(toBloodPressureDto);
    },
  };
}
