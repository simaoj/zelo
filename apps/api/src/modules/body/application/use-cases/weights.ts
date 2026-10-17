import type { CreateWeightRequest, UpdateWeightRequest, WeightEntry as WeightEntryDto, WeightPage } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, TxContext } from '../../../../shared/application/ports.js';
import { DuplicateIdError, type HistoryParams } from '../../../../shared/application/repository-errors.js';
import { NotFoundError, VersionConflictError } from '../../../../shared/domain/errors.js';
import { changeWeightEntry, createWeightEntry, deleteWeightEntry, weightDelta, type WeightEntry } from '../../domain/entities/weight-entry.js';
import { toWeightDto } from '../dto.js';
import type { Position, WeightRepository } from '../ports/out/index.js';

/** Presents entries with their server-computed delta. */
export class WeightPresenter {
  constructor(private readonly repo: WeightRepository) {}
  async present(e: WeightEntry, tx?: TxContext): Promise<WeightEntryDto> {
    const prev = await this.repo.previousOf(e.userId, e, tx);
    return toWeightDto(e, weightDelta(e, prev));
  }
}

abstract class WeightMutation {
  constructor(
    protected readonly repo: WeightRepository,
    protected readonly clock: Clock,
    protected readonly changeLog: ChangeLog,
    protected readonly presenter: WeightPresenter,
  ) {}

  /** Successors' deltas change when an entry is inserted/moved/removed → emit upserts for sync. */
  protected async touchSuccessors(userId: string, positions: Position[], exceptId: string, tx: TxContext): Promise<void> {
    const ids = new Set<string>();
    for (const pos of positions) {
      const next = await this.repo.nextOf(userId, pos, tx);
      if (next && next.id !== exceptId) ids.add(next.id);
    }
    for (const id of ids) await this.changeLog.record(tx, userId, { entity: 'weightEntry', id, op: 'upsert' });
  }

  protected async loadLive(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<WeightEntry> {
    const current = await this.repo.findById(actor.userId, id, tx);
    if (!current || current.deletedAt) throw new NotFoundError('Registro de peso');
    if (current.version !== expectedVersion) throw new VersionConflictError(await this.presenter.present(current, tx));
    return current;
  }

  protected async conflict(actor: Actor, id: string, tx: TxContext): Promise<never> {
    const fresh = await this.repo.findById(actor.userId, id, tx);
    if (!fresh || fresh.deletedAt) throw new NotFoundError('Registro de peso');
    throw new VersionConflictError(await this.presenter.present(fresh, tx));
  }
}

export class RegisterWeight extends WeightMutation {
  async execute(actor: Actor, input: CreateWeightRequest, tx: TxContext): Promise<WeightEntryDto> {
    const entry = createWeightEntry(
      { id: input.id, userId: actor.userId, measuredAt: new Date(input.measuredAt), timezone: input.timezone, weightKg: input.weightKg, notes: input.notes },
      this.clock.now(),
    );
    try {
      await this.repo.insert(entry, tx);
    } catch (err) {
      if (!(err instanceof DuplicateIdError)) throw err;
      // id already used: by this user → conflict with current; by another user → conflict without data
      const own = await this.repo.findById(actor.userId, input.id, tx);
      throw new VersionConflictError(own && !own.deletedAt ? await this.presenter.present(own, tx) : undefined);
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'weightEntry', id: entry.id, op: 'upsert' });
    await this.touchSuccessors(actor.userId, [entry], entry.id, tx);
    return this.presenter.present(entry, tx);
  }
}

export class UpdateWeight extends WeightMutation {
  async execute(actor: Actor, id: string, input: UpdateWeightRequest, tx: TxContext): Promise<WeightEntryDto> {
    const current = await this.loadLive(actor, id, input.expectedVersion, tx);
    const next = changeWeightEntry(
      current,
      { measuredAt: input.measuredAt ? new Date(input.measuredAt) : undefined, timezone: input.timezone, weightKg: input.weightKg, notes: input.notes },
      this.clock.now(),
    );
    if (!(await this.repo.updateIfVersion(next, input.expectedVersion, tx))) return this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'weightEntry', id, op: 'upsert' });
    await this.touchSuccessors(actor.userId, [current, next], id, tx);
    return this.presenter.present(next, tx);
  }
}

export class DeleteWeight extends WeightMutation {
  async execute(actor: Actor, id: string, expectedVersion: number, tx: TxContext): Promise<void> {
    const current = await this.loadLive(actor, id, expectedVersion, tx);
    const next = deleteWeightEntry(current, this.clock.now());
    if (!(await this.repo.updateIfVersion(next, expectedVersion, tx))) await this.conflict(actor, id, tx);
    await this.changeLog.record(tx, actor.userId, { entity: 'weightEntry', id, op: 'delete' });
    await this.touchSuccessors(actor.userId, [current], id, tx);
  }
}

export class ListWeights {
  constructor(private readonly repo: WeightRepository) {}
  async execute(actor: Actor, params: HistoryParams): Promise<WeightPage> {
    const page = await this.repo.page(actor.userId, params);
    const items: WeightEntryDto[] = [];
    for (let i = 0; i < page.items.length; i++) {
      const e = page.items[i]!;
      // the page is desc → the next item (or lookahead) is the chronologically previous entry
      const prev = i + 1 < page.items.length ? page.items[i + 1]! : (page.lookahead ?? (await this.repo.previousOf(actor.userId, e)));
      items.push(toWeightDto(e, weightDelta(e, prev)));
    }
    return { items, nextCursor: page.nextCursor };
  }
}
