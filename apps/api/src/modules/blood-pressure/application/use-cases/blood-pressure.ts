import type { BloodPressureEntry as Dto, BloodPressurePage, CreateBloodPressureRequest, UpdateBloodPressureRequest } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, TxContext } from '../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryParams } from '../../../../shared/application/repository-errors.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import {
  changeBloodPressureEntry,
  createBloodPressureEntry,
  deleteBloodPressureEntry,
  type BloodPressureEntry,
} from '../../domain/entities/blood-pressure-entry.js';
import { toBloodPressureDto } from '../dto.js';
import type { BloodPressureRepository } from '../ports/out/blood-pressure-repository.js';

abstract class Mutation {
  constructor(
    protected readonly repo: BloodPressureRepository,
    protected readonly clock: Clock,
    protected readonly changeLog: ChangeLog,
  ) {}
  protected async loadLive(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<BloodPressureEntry> {
    const current = await this.repo.findById(actor.userId, id, tx);
    if (!current || current.deletedAt) throw new NotFoundError('Registro de pressão');
    if (current.version !== expectedVersion) throw new VersionConflictError(toBloodPressureDto(current));
    return current;
  }
  protected async conflict(actor: Actor, id: string, tx: TxContext): Promise<never> {
    const fresh = await this.repo.findById(actor.userId, id, tx);
    if (!fresh || fresh.deletedAt) throw new NotFoundError('Registro de pressão');
    throw new VersionConflictError(toBloodPressureDto(fresh));
  }
}

export class RegisterBloodPressure extends Mutation {
  async execute(actor: Actor, input: CreateBloodPressureRequest, tx: TxContext): Promise<Dto> {
    const entry = createBloodPressureEntry(
      {
        id: input.id,
        userId: actor.userId,
        measuredAt: new Date(input.measuredAt),
        timezone: input.timezone,
        systolic: input.systolic,
        diastolic: input.diastolic,
        pulseBpm: input.pulseBpm,
        notes: input.notes,
        confirmedUnusual: input.confirmedUnusual,
      },
      this.clock.now(),
    );
    try {
      await this.repo.insert(entry, tx);
    } catch (err) {
      if (!(err instanceof DuplicateIdError)) throw err;
      const own = await this.repo.findById(actor.userId, input.id, tx);
      throw new VersionConflictError(own && !own.deletedAt ? toBloodPressureDto(own) : undefined);
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'bloodPressureEntry', id: entry.id, op: 'upsert' });
    return toBloodPressureDto(entry);
  }
}

export class UpdateBloodPressure extends Mutation {
  async execute(actor: Actor, id: string, input: UpdateBloodPressureRequest, tx: TxContext): Promise<Dto> {
    const current = await this.loadLive(actor, id, input.expectedVersion, tx);
    const next = changeBloodPressureEntry(
      current,
      {
        measuredAt: input.measuredAt ? new Date(input.measuredAt) : undefined,
        timezone: input.timezone,
        systolic: input.systolic,
        diastolic: input.diastolic,
        pulseBpm: input.pulseBpm,
        notes: input.notes,
        confirmedUnusual: input.confirmedUnusual,
      },
      this.clock.now(),
    );
    if (!(await this.repo.updateIfVersion(next, input.expectedVersion, tx))) return this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'bloodPressureEntry', id, op: 'upsert' });
    return toBloodPressureDto(next);
  }
}

export class DeleteBloodPressure extends Mutation {
  async execute(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<void> {
    const current = await this.loadLive(actor, id, expectedVersion, tx);
    if (!(await this.repo.updateIfVersion(deleteBloodPressureEntry(current, this.clock.now()), expectedVersion, tx))) await this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'bloodPressureEntry', id, op: 'delete' });
  }
}

export class ListBloodPressure {
  constructor(private readonly repo: BloodPressureRepository) {}
  async execute(actor: Actor, params: HistoryParams): Promise<BloodPressurePage> {
    const page = await this.repo.page(actor.userId, params);
    return { items: page.items.map(toBloodPressureDto), nextCursor: page.nextCursor };
  }
}

export function createBloodPressureUseCases(d: { repo: BloodPressureRepository; clock: Clock; changeLog: ChangeLog }) {
  return {
    register: new RegisterBloodPressure(d.repo, d.clock, d.changeLog),
    update: new UpdateBloodPressure(d.repo, d.clock, d.changeLog),
    remove: new DeleteBloodPressure(d.repo, d.clock, d.changeLog),
    list: new ListBloodPressure(d.repo),
  };
}
export type BloodPressureUseCases = ReturnType<typeof createBloodPressureUseCases>;
