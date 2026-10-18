import {
  routes,
  type BloodPressureEntry,
  type BloodPressurePage,
  type CreateBloodPressureRequest,
  type CreateIntakeRequest,
  type CreateMeasurementRequest,
  type CreateRoutineItemRequest,
  type CreateWeightRequest,
  type DashboardResponse,
  type DeleteRequest,
  type HistoryQuery,
  type IntakeRecord,
  type MeasurementPage,
  type MeasurementSession,
  type OccurrenceList,
  type Profile,
  type PutOccurrenceIntakeRequest,
  type PutWeightGoalRequest,
  type ReviseScheduleRequest,
  type RoutineItem,
  type UpdateBloodPressureRequest,
  type UpdateIntakeRequest,
  type UpdateMeasurementRequest,
  type UpdateProfileRequest,
  type UpdateRoutineItemRequest,
  type UpdateWeightRequest,
  type WeightEntry,
  type WeightGoal,
  type WeightPage,
  type ActivityGoal,
  type ActivityToday,
  type CreateWaterEntryRequest,
  type HydrationGoal,
  type HydrationSummary,
  type PutActivityGoalRequest,
  type PutHydrationGoalRequest,
  type StepsSummary,
  type UpdateWaterEntryRequest,
  type WaterEntry,
  type WaterEntryPage,
  type Workout,
  type WorkoutPage,
  type WorkoutsQuery,
} from '@zelo/contracts';
import { DataError, type Mutation, type ZeloDataSource } from '@/shared/data/ports';
import type { HttpClient } from './client';
import { uuid } from '@/shared/lib/ids';

/** Online-only data source that talks to the Zelo API. */
export class HttpDataSource implements ZeloDataSource {
  private listeners = new Set<() => void>();

  constructor(private readonly http: HttpClient) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        /* listener errors must not break mutations */
      }
    }
  }

  private async mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
    const result = await this.http.request<T>(method, path, { body });
    this.notify();
    return result;
  }

  private async server<T>(method: string, path: string, body?: unknown): Promise<Mutation<T>> {
    const value = await this.mutate<T>(method, path, body);
    return { value, persistence: 'server' };
  }

  // profile & dashboard
  getProfile() {
    return this.http.request<Profile>('GET', routes.profile);
  }
  updateProfile(input: UpdateProfileRequest) {
    return this.mutate<Profile>('PATCH', routes.profile, input);
  }
  getDashboard(date?: string) {
    return this.http.request<DashboardResponse>('GET', routes.dashboard, { query: { date } });
  }

  // weight
  listWeights(q: HistoryQuery) {
    return this.http.request<WeightPage>('GET', routes.weights, { query: q });
  }
  createWeight(input: CreateWeightRequest) {
    return this.server<WeightEntry>('POST', routes.weights, input);
  }
  updateWeight(id: string, input: UpdateWeightRequest) {
    return this.server<WeightEntry>('PATCH', routes.weight(id), input);
  }
  deleteWeight(id: string, input: DeleteRequest) {
    return this.server<null>('DELETE', routes.weight(id), input);
  }
  async getWeightGoal() {
    try {
      return await this.http.request<WeightGoal>('GET', routes.weightGoal);
    } catch (e) {
      if (e instanceof DataError && e.status === 404) return null;
      throw e;
    }
  }
  putWeightGoal(input: PutWeightGoalRequest) {
    return this.mutate<WeightGoal>('PUT', routes.weightGoal, input);
  }
  async deleteWeightGoal() {
    await this.mutate<null>('DELETE', routes.weightGoal, { operationId: uuid() });
  }

  // measurements
  listMeasurements(q: HistoryQuery) {
    return this.http.request<MeasurementPage>('GET', routes.measurements, { query: q });
  }
  createMeasurement(input: CreateMeasurementRequest) {
    return this.server<MeasurementSession>('POST', routes.measurements, input);
  }
  updateMeasurement(id: string, input: UpdateMeasurementRequest) {
    return this.server<MeasurementSession>('PATCH', routes.measurement(id), input);
  }
  deleteMeasurement(id: string, input: DeleteRequest) {
    return this.server<null>('DELETE', routes.measurement(id), input);
  }

  // blood pressure
  listBloodPressure(q: HistoryQuery) {
    return this.http.request<BloodPressurePage>('GET', routes.bloodPressure, { query: q });
  }
  createBloodPressure(input: CreateBloodPressureRequest) {
    return this.server<BloodPressureEntry>('POST', routes.bloodPressure, input);
  }
  updateBloodPressure(id: string, input: UpdateBloodPressureRequest) {
    return this.server<BloodPressureEntry>('PATCH', routes.bloodPressureEntry(id), input);
  }
  deleteBloodPressure(id: string, input: DeleteRequest) {
    return this.server<null>('DELETE', routes.bloodPressureEntry(id), input);
  }

  // routine
  async listRoutineItems(includeArchived: boolean) {
    const res = await this.http.request<{ items: RoutineItem[] }>('GET', routes.routineItems, {
      query: { includeArchived: includeArchived ? 'true' : undefined },
    });
    return res.items;
  }
  createRoutineItem(input: CreateRoutineItemRequest) {
    return this.mutate<RoutineItem>('POST', routes.routineItems, input);
  }
  updateRoutineItem(id: string, input: UpdateRoutineItemRequest) {
    return this.mutate<RoutineItem>('PATCH', routes.routineItem(id), input);
  }
  reviseSchedule(id: string, input: ReviseScheduleRequest) {
    return this.mutate<RoutineItem>('POST', routes.routineItemSchedules(id), input);
  }
  archiveRoutineItem(id: string, input: DeleteRequest) {
    return this.mutate<RoutineItem>('POST', routes.routineItemArchive(id), input);
  }
  listOccurrences(date: string) {
    return this.http.request<OccurrenceList>('GET', routes.occurrences, { query: { date } });
  }
  putOccurrenceIntake(occurrenceId: string, input: PutOccurrenceIntakeRequest) {
    return this.server<IntakeRecord>('PUT', routes.occurrenceIntake(occurrenceId), input);
  }
  undoOccurrenceIntake(occurrenceId: string, input: DeleteRequest) {
    return this.server<null>('DELETE', routes.occurrenceIntake(occurrenceId), input);
  }
  createIntake(input: CreateIntakeRequest) {
    return this.server<IntakeRecord>('POST', routes.intakes, input);
  }
  listIntakes(q: HistoryQuery) {
    return this.http.request<{ items: IntakeRecord[]; nextCursor: string | null }>('GET', routes.intakes, { query: q });
  }
  updateIntake(id: string, input: UpdateIntakeRequest) {
    return this.mutate<IntakeRecord>('PATCH', routes.intake(id), input);
  }
  async deleteIntake(id: string, input: DeleteRequest) {
    await this.mutate<null>('DELETE', routes.intake(id), input);
  }

  // hydration
  listWaterEntries(q: HistoryQuery) {
    return this.http.request<WaterEntryPage>('GET', routes.waterEntries, { query: q });
  }
  createWaterEntry(input: CreateWaterEntryRequest) {
    return this.server<WaterEntry>('POST', routes.waterEntries, input);
  }
  updateWaterEntry(id: string, input: UpdateWaterEntryRequest) {
    return this.server<WaterEntry>('PATCH', routes.waterEntry(id), input);
  }
  deleteWaterEntry(id: string, input: DeleteRequest) {
    return this.server<null>('DELETE', routes.waterEntry(id), input);
  }
  getHydrationSummary(from: string, to: string) {
    return this.http.request<HydrationSummary>('GET', routes.hydrationSummary, { query: { from, to } });
  }
  async getHydrationGoal() {
    try {
      return await this.http.request<HydrationGoal>('GET', routes.hydrationGoal);
    } catch (e) {
      if (e instanceof DataError && e.status === 404) return null;
      throw e;
    }
  }
  putHydrationGoal(input: PutHydrationGoalRequest) {
    return this.mutate<HydrationGoal>('PUT', routes.hydrationGoal, input);
  }
  async deleteHydrationGoal() {
    await this.mutate<null>('DELETE', routes.hydrationGoal, { operationId: uuid() });
  }

  // activity (read-only received data + optional steps goal)
  getActivityToday(date?: string) {
    return this.http.request<ActivityToday>('GET', routes.activityToday, { query: { date } });
  }
  getStepsSummary(from: string, to: string) {
    return this.http.request<StepsSummary>('GET', routes.activitySteps, { query: { from, to } });
  }
  listWorkouts(q: WorkoutsQuery) {
    return this.http.request<WorkoutPage>('GET', routes.workouts, { query: q });
  }
  getWorkout(id: string) {
    return this.http.request<Workout>('GET', routes.workout(id));
  }
  async getActivityGoal() {
    try {
      return await this.http.request<ActivityGoal>('GET', routes.activityGoal);
    } catch (e) {
      if (e instanceof DataError && e.status === 404) return null;
      throw e;
    }
  }
  putActivityGoal(input: PutActivityGoalRequest) {
    return this.mutate<ActivityGoal>('PUT', routes.activityGoal, input);
  }
  async deleteActivityGoal() {
    await this.mutate<null>('DELETE', routes.activityGoal, { operationId: uuid() });
  }
}
