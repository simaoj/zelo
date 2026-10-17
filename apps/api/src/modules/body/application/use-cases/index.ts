import type { ChangeLog, Clock, IdGenerator, UnitOfWork } from '../../../../shared/application/ports.js';
import type { MeasurementRepository, WeightGoalRepository, WeightRepository } from '../ports/out/index.js';
import { DeleteMeasurements, ListMeasurements, RegisterMeasurements, UpdateMeasurements } from './measurements.js';
import { WeightGoalUseCases } from './weight-goal.js';
import { DeleteWeight, ListWeights, RegisterWeight, UpdateWeight, WeightPresenter } from './weights.js';

export * from './weights.js';
export * from './weight-goal.js';
export * from './measurements.js';

export function createBodyUseCases(d: {
  weights: WeightRepository;
  goals: WeightGoalRepository;
  measurements: MeasurementRepository;
  clock: Clock;
  ids: IdGenerator;
  changeLog: ChangeLog;
  uow: UnitOfWork;
}) {
  const presenter = new WeightPresenter(d.weights);
  return {
    uow: d.uow,
    presenter,
    registerWeight: new RegisterWeight(d.weights, d.clock, d.changeLog, presenter),
    updateWeight: new UpdateWeight(d.weights, d.clock, d.changeLog, presenter),
    deleteWeight: new DeleteWeight(d.weights, d.clock, d.changeLog, presenter),
    listWeights: new ListWeights(d.weights),
    weightGoal: new WeightGoalUseCases(d.goals, d.clock, d.ids, d.changeLog),
    registerMeasurements: new RegisterMeasurements(d.measurements, d.clock, d.changeLog),
    updateMeasurements: new UpdateMeasurements(d.measurements, d.clock, d.changeLog),
    deleteMeasurements: new DeleteMeasurements(d.measurements, d.clock, d.changeLog),
    listMeasurements: new ListMeasurements(d.measurements),
  };
}
export type BodyUseCases = ReturnType<typeof createBodyUseCases>;
