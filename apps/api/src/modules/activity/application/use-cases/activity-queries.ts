import type { ActivityGoal as ActivityGoalDto, ActivityToday, PutActivityGoalRequest, StepsDay, StepsSummary, Workout as WorkoutDto, WorkoutPage } from '@zelo/contracts';
import type { Actor, ChangeLog, Clock, IdGenerator, TxContext } from '../../../../shared/application/ports.js';
import { NotFoundError, ValidationError } from '../../../../shared/domain/errors.js';
import { assertLocalDate, changeActivityGoal, createActivityGoal, datesBetween, localToday, type DailySteps } from '../../domain/activity.js';
import { toActivityGoalDto, toWorkoutDto } from '../dto.js';
import type { ActivityGoalRepository, DailyStepsRepository, TimezoneReader, WorkoutPosition, WorkoutRepository } from '../ports/out/index.js';

function latest(a: Date | null, b: Date | null): string | null {
  const m = a && b ? (a > b ? a : b) : (a ?? b);
  return m ? m.toISOString() : null;
}

function stepsDay(date: string, s: DailySteps | undefined | null, today: string): StepsDay {
  return { date, count: s ? s.count : null, partial: date === today, receivedAt: s ? s.receivedAt.toISOString() : null };
}

export class GetDailySteps {
  constructor(private readonly d: { steps: DailyStepsRepository; workouts: WorkoutRepository; goals: ActivityGoalRepository; profiles: TimezoneReader; clock: Clock }) {}

  async execute(actor: Actor, q: { from: string; to: string }): Promise<StepsSummary> {
    const dates = datesBetween(q.from, q.to);
    const tz = await this.d.profiles.getTimezone(actor.userId);
    const today = localToday(this.d.clock.now(), tz);
    const [rows, goal, lastSteps, lastWorkout] = await Promise.all([
      this.d.steps.listRange(actor.userId, q.from, q.to),
      this.d.goals.findActive(actor.userId),
      this.d.steps.lastReceivedAt(actor.userId),
      this.d.workouts.lastReceivedAt(actor.userId),
    ]);
    const byDate = new Map(rows.map((r) => [r.localDate, r]));
    const days = dates.map((d) => stepsDay(d, byDate.get(d), today));
    const withData = days.filter((d) => d.count !== null);
    const avg = withData.length ? Math.round(withData.reduce((s, d) => s + (d.count ?? 0), 0) / withData.length) : null;
    return {
      from: q.from,
      to: q.to,
      days,
      goal: goal ? toActivityGoalDto(goal) : null,
      averageOnDaysWithData: avg,
      lastReceivedAt: latest(lastSteps, lastWorkout),
    };
  }
}

export class GetActivityToday {
  constructor(private readonly d: { steps: DailyStepsRepository; workouts: WorkoutRepository; goals: ActivityGoalRepository; profiles: TimezoneReader; clock: Clock }) {}

  /** `date` defaults to today in the profile timezone. */
  async forUser(userId: string, date?: string): Promise<ActivityToday> {
    const tz = await this.d.profiles.getTimezone(userId);
    return this.execute(userId, date ?? localToday(this.d.clock.now(), tz), tz);
  }

  /** `date` is a local date in `timezone` (the profile tz); `partial` is true when it is today there. */
  async execute(userId: string, date: string, timezone: string): Promise<ActivityToday> {
    assertLocalDate(date, 'date');
    const today = localToday(this.d.clock.now(), timezone);
    const [s, ws, goal, lastSteps, lastWorkout] = await Promise.all([
      this.d.steps.findByDate(userId, date),
      this.d.workouts.listByLocalDate(userId, date),
      this.d.goals.findActive(userId),
      this.d.steps.lastReceivedAt(userId),
      this.d.workouts.lastReceivedAt(userId),
    ]);
    return {
      date,
      steps: stepsDay(date, s, today),
      stepsGoal: goal ? toActivityGoalDto(goal) : null,
      workoutCount: ws.length,
      workoutSeconds: ws.reduce((sum, w) => sum + w.durationSeconds, 0),
      lastReceivedAt: latest(lastSteps, lastWorkout),
    };
  }
}

export const DEFAULT_WORKOUT_LIMIT = 50;

export interface WorkoutCursorCodec {
  encode(p: WorkoutPosition): string;
  /** null when malformed */
  decode(cursor: string): WorkoutPosition | null;
}

export class ListWorkouts {
  constructor(private readonly d: { workouts: WorkoutRepository; cursor: WorkoutCursorCodec }) {}

  async execute(actor: Actor, q: { from?: string | undefined; to?: string | undefined; name?: string | undefined; cursor?: string | undefined; limit?: number | undefined }): Promise<WorkoutPage> {
    if (q.from) assertLocalDate(q.from, 'from');
    if (q.to) assertLocalDate(q.to, 'to');
    if (q.from && q.to && q.from > q.to) throw new ValidationError('Período inválido', { to: ['Deve ser igual ou posterior a from'] });
    const after = q.cursor ? this.d.cursor.decode(q.cursor) : null;
    if (q.cursor && !after) throw new ValidationError('Cursor inválido', { cursor: ['Cursor inválido'] });
    const limit = Math.min(Math.max(q.limit ?? DEFAULT_WORKOUT_LIMIT, 1), 200);
    const [rows, availableNames] = await Promise.all([
      this.d.workouts.page(actor.userId, { from: q.from, to: q.to, name: q.name, after, limit }),
      this.d.workouts.distinctNames(actor.userId),
    ]);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(toWorkoutDto),
      nextCursor: rows.length > limit && last ? this.d.cursor.encode({ startedAt: last.startedAt, id: last.id }) : null,
      availableNames,
    };
  }
}

export class GetWorkoutDetails {
  constructor(private readonly workouts: WorkoutRepository) {}
  /** 404 for unknown ids and for workouts of other users. */
  async execute(actor: Actor, id: string): Promise<WorkoutDto> {
    const w = await this.workouts.findById(actor.userId, id);
    if (!w) throw new NotFoundError('Exercício');
    return toWorkoutDto(w);
  }
}

/** Steps goal is a per-user singleton; its sync entity id is the userId. */
export class StepsGoalUseCases {
  constructor(private readonly d: { goals: ActivityGoalRepository; clock: Clock; ids: IdGenerator; changeLog: ChangeLog }) {}

  async get(actor: Actor): Promise<ActivityGoalDto> {
    const g = await this.d.goals.findActive(actor.userId);
    if (!g) throw new NotFoundError('Meta');
    return toActivityGoalDto(g);
  }

  async put(actor: Actor, input: Pick<PutActivityGoalRequest, 'dailyStepsTarget'>, tx: TxContext): Promise<ActivityGoalDto> {
    const now = this.d.clock.now();
    const current = await this.d.goals.findActive(actor.userId, tx);
    let saved;
    if (current) {
      saved = changeActivityGoal(current, input.dailyStepsTarget, now);
      if (!(await this.d.goals.updateIfVersion(saved, current.version, tx))) throw new Error('activity goal changed concurrently');
    } else {
      saved = createActivityGoal({ id: this.d.ids.next(), userId: actor.userId, dailyStepsTarget: input.dailyStepsTarget }, now);
      await this.d.goals.insert(saved, tx);
    }
    await this.d.changeLog.record(tx, actor.userId, { entity: 'activityGoal', id: actor.userId, op: 'upsert' });
    return toActivityGoalDto(saved);
  }

  async remove(actor: Actor, tx: TxContext): Promise<void> {
    if (!(await this.d.goals.deactivate(actor.userId, this.d.clock.now(), tx))) throw new NotFoundError('Meta');
    await this.d.changeLog.record(tx, actor.userId, { entity: 'activityGoal', id: actor.userId, op: 'delete' });
  }
}

