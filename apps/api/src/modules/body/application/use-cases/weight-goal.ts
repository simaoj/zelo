import type { PutWeightGoalRequest, WeightGoal as WeightGoalDto } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, IdGenerator, TxContext } from '../../../../shared/application/ports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { changeWeightGoal, createWeightGoal } from '../../domain/entities/weight-goal.js';
import { toWeightGoalDto } from '../dto.js';
import type { WeightGoalRepository } from '../ports/out/index.js';

/** The weight goal is a per-user singleton; its sync entity id is the userId. */
export class WeightGoalUseCases {
  constructor(
    private readonly repo: WeightGoalRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly changeLog: ChangeLog,
  ) {}

  async get(actor: Actor, tx?: TxContext): Promise<WeightGoalDto> {
    const g = await this.repo.findActive(actor.userId, tx);
    if (!g) throw new NotFoundError('Meta');
    return toWeightGoalDto(g);
  }

  async put(actor: Actor, input: Pick<PutWeightGoalRequest, 'targetKg'>, tx: TxContext): Promise<WeightGoalDto> {
    const now = this.clock.now();
    const current = await this.repo.findActive(actor.userId, tx);
    let saved;
    if (current) {
      saved = changeWeightGoal(current, input.targetKg, now);
      if (!(await this.repo.updateIfVersion(saved, current.version, tx))) throw new Error('weight goal changed concurrently');
    } else {
      saved = createWeightGoal({ id: this.ids.next(), userId: actor.userId, targetKg: input.targetKg }, now);
      await this.repo.insert(saved, tx);
    }
    await this.changeLog.record(tx, actor.userId, { entity: 'weightGoal', id: actor.userId, op: 'upsert' });
    return toWeightGoalDto(saved);
  }

  async remove(actor: Actor, tx: TxContext): Promise<void> {
    if (!(await this.repo.deactivate(actor.userId, this.clock.now(), tx))) throw new NotFoundError('Meta');
    await this.changeLog.record(tx, actor.userId, { entity: 'weightGoal', id: actor.userId, op: 'delete' });
  }
}
