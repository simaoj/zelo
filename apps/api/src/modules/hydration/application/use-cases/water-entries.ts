import type { CreateWaterEntryRequest, UpdateWaterEntryRequest, WaterEntry as WaterEntryDto, WaterEntryPage } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, TxContext } from '../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryParams } from '../../../../shared/application/repository-errors.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { changeWaterEntry, createWaterEntry, deleteWaterEntry, type WaterEntry } from '../../domain/water-entry.js';
import { toWaterEntryDto } from '../dto.js';
import type { WaterEntryRepository } from '../ports/index.js';

const WHAT = 'Registro de água';

abstract class WaterMutation {
  constructor(
    protected readonly repo: WaterEntryRepository,
    protected readonly clock: Clock,
    protected readonly changeLog: ChangeLog,
  ) {}

  protected async loadLive(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<WaterEntry> {
    const current = await this.repo.findById(actor.userId, id, tx);
    if (!current || current.deletedAt) throw new NotFoundError(WHAT);
    if (current.version !== expectedVersion) throw new VersionConflictError(toWaterEntryDto(current));
    return current;
  }

  protected async conflict(actor: Actor, id: string, tx: TxContext): Promise<never> {
    const fresh = await this.repo.findById(actor.userId, id, tx);
    if (!fresh || fresh.deletedAt) throw new NotFoundError(WHAT);
    throw new VersionConflictError(toWaterEntryDto(fresh));
  }
}

export class RegisterWaterIntake extends WaterMutation {
  async execute(actor: Actor, input: CreateWaterEntryRequest, tx: TxContext): Promise<WaterEntryDto> {
    const entry = createWaterEntry(
      { id: input.id, userId: actor.userId, consumedAt: new Date(input.consumedAt), timezone: input.timezone, amountMl: input.amountMl, notes: input.notes },
      this.clock.now(),
    );
    const owner = await this.repo.ownerOf(entry.id, tx);
    if (owner) {
      // id already used: by this user → conflict with its current state; by another user → conflict, nothing revealed
      const own = owner === actor.userId ? await this.repo.findById(actor.userId, entry.id, tx) : null;
      throw new VersionConflictError(own && !own.deletedAt ? toWaterEntryDto(own) : undefined);
    }
    try {
      await this.repo.insert(entry, tx);
    } catch (err) {
      if (err instanceof DuplicateIdError) throw new VersionConflictError(undefined);
      throw err;
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'waterEntry', id: entry.id, op: 'upsert' });
    return toWaterEntryDto(entry);
  }
}

export class UpdateWaterIntake extends WaterMutation {
  async execute(actor: Actor, id: string, input: UpdateWaterEntryRequest, tx: TxContext): Promise<WaterEntryDto> {
    const current = await this.loadLive(actor, id, input.expectedVersion, tx);
    const next = changeWaterEntry(
      current,
      { consumedAt: input.consumedAt ? new Date(input.consumedAt) : undefined, timezone: input.timezone, amountMl: input.amountMl, notes: input.notes },
      this.clock.now(),
    );
    if (!(await this.repo.updateIfVersion(next, input.expectedVersion, tx))) return this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'waterEntry', id, op: 'upsert' });
    return toWaterEntryDto(next);
  }
}

export class DeleteWaterIntake extends WaterMutation {
  async execute(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<void> {
    const current = await this.loadLive(actor, id, expectedVersion, tx);
    const next = deleteWaterEntry(current, this.clock.now());
    if (!(await this.repo.updateIfVersion(next, expectedVersion, tx))) await this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'waterEntry', id, op: 'delete' });
  }
}

export class ListWaterEntries {
  constructor(private readonly repo: WaterEntryRepository) {}
  async execute(actor: Actor, params: HistoryParams): Promise<WaterEntryPage> {
    const page = await this.repo.page(actor.userId, params);
    return { items: page.items.map(toWaterEntryDto), nextCursor: page.nextCursor };
  }
}
