import type { CreateMeasurementRequest, MeasurementPage, MeasurementSession as MeasurementDto, UpdateMeasurementRequest } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, TxContext } from '../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryParams } from '../../../../shared/application/repository-errors.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import {
  changeMeasurementSession,
  createMeasurementSession,
  deleteMeasurementSession,
  type MeasurementSession,
} from '../../domain/entities/measurement-session.js';
import { toMeasurementDto } from '../dto.js';
import type { MeasurementRepository } from '../ports/out/index.js';

abstract class MeasurementMutation {
  constructor(
    protected readonly repo: MeasurementRepository,
    protected readonly clock: Clock,
    protected readonly changeLog: ChangeLog,
  ) {}

  protected async loadLive(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<MeasurementSession> {
    const current = await this.repo.findById(actor.userId, id, tx);
    if (!current || current.deletedAt) throw new NotFoundError('Sessão de medidas');
    if (current.version !== expectedVersion) throw new VersionConflictError(toMeasurementDto(current));
    return current;
  }

  protected async conflict(actor: Actor, id: string, tx: TxContext): Promise<never> {
    const fresh = await this.repo.findById(actor.userId, id, tx);
    if (!fresh || fresh.deletedAt) throw new NotFoundError('Sessão de medidas');
    throw new VersionConflictError(toMeasurementDto(fresh));
  }
}

export class RegisterMeasurements extends MeasurementMutation {
  async execute(actor: Actor, input: CreateMeasurementRequest, tx: TxContext): Promise<MeasurementDto> {
    const session = createMeasurementSession(
      { id: input.id, userId: actor.userId, measuredAt: new Date(input.measuredAt), timezone: input.timezone, notes: input.notes, values: input.values },
      this.clock.now(),
    );
    try {
      await this.repo.insert(session, tx);
    } catch (err) {
      if (!(err instanceof DuplicateIdError)) throw err;
      const own = await this.repo.findById(actor.userId, input.id, tx);
      throw new VersionConflictError(own && !own.deletedAt ? toMeasurementDto(own) : undefined);
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'measurementSession', id: session.id, op: 'upsert' });
    return toMeasurementDto(session);
  }
}

export class UpdateMeasurements extends MeasurementMutation {
  async execute(actor: Actor, id: string, input: UpdateMeasurementRequest, tx: TxContext): Promise<MeasurementDto> {
    const current = await this.loadLive(actor, id, input.expectedVersion, tx);
    const next = changeMeasurementSession(
      current,
      { measuredAt: input.measuredAt ? new Date(input.measuredAt) : undefined, timezone: input.timezone, notes: input.notes, values: input.values },
      this.clock.now(),
    );
    if (!(await this.repo.updateIfVersion(next, input.expectedVersion, tx))) return this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'measurementSession', id, op: 'upsert' });
    return toMeasurementDto(next);
  }
}

export class DeleteMeasurements extends MeasurementMutation {
  async execute(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<void> {
    const current = await this.loadLive(actor, id, expectedVersion, tx);
    if (!(await this.repo.updateIfVersion(deleteMeasurementSession(current, this.clock.now()), expectedVersion, tx))) await this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'measurementSession', id, op: 'delete' });
  }
}

export class ListMeasurements {
  constructor(private readonly repo: MeasurementRepository) {}
  async execute(actor: Actor, params: HistoryParams): Promise<MeasurementPage> {
    const page = await this.repo.page(actor.userId, params);
    return { items: page.items.map(toMeasurementDto), nextCursor: page.nextCursor };
  }
}
