import type { HydrationGoal as HydrationGoalDto } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, IdGenerator, TxContext } from '../../../../shared/application/ports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { changeHydrationGoal, createHydrationGoal } from '../../domain/hydration-goal.js';
import { toHydrationGoalDto } from '../dto.js';
import type { HydrationGoalRepository } from '../ports/index.js';

/** GetHydrationGoal / SetHydrationGoal / RemoveHydrationGoal. Per-user singleton; its sync entity id is the userId. */
export class HydrationGoalUseCases {
  constructor(
    private readonly repo: HydrationGoalRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly changeLog: ChangeLog,
  ) {}

  async find(userId: string, tx?: TxContext): Promise<HydrationGoalDto | null> {
    const g = await this.repo.findActive(userId, tx);
    return g ? toHydrationGoalDto(g) : null;
  }

  async get(actor: Actor, tx?: TxContext): Promise<HydrationGoalDto> {
    const g = await this.find(actor.userId, tx);
    if (!g) throw new NotFoundError('Meta');
    return g;
  }

  async set(actor: Actor, input: { dailyTargetMl: number }, tx: TxContext): Promise<HydrationGoalDto> {
    const now = this.clock.now();
    const current = await this.repo.findActive(actor.userId, tx);
    let saved;
    if (current) {
      saved = changeHydrationGoal(current, input.dailyTargetMl, now);
      if (!(await this.repo.updateIfVersion(saved, current.version, tx))) throw new Error('hydration goal changed concurrently');
    } else {
      saved = createHydrationGoal({ id: this.ids.next(), userId: actor.userId, dailyTargetMl: input.dailyTargetMl }, now);
      await this.repo.insert(saved, tx);
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'hydrationGoal', id: actor.userId, op: 'upsert' });
    return toHydrationGoalDto(saved);
  }

  async remove(actor: Actor, tx: TxContext): Promise<void> {
    if (!(await this.repo.deactivate(actor.userId, this.clock.now(), tx))) throw new NotFoundError('Meta');
    await this.changeLog.record(tx, actor.userId, { entity: 'hydrationGoal', id: actor.userId, op: 'delete' });
  }
}
