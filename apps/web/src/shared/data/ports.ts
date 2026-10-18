/**
 * Frontend data ports. React components NEVER talk to fetch/IndexedDB directly:
 * they use hooks that call a `ZeloDataSource` obtained from context.
 *
 * Implementations:
 *  - HttpDataSource       (src/infrastructure/http)     – online only, calls the API.
 *  - OfflineFirstDataSource (src/infrastructure/offline) – wraps HttpDataSource; when the
 *    user enabled offline on this device it reads from IndexedDB and queues allowed mutations.
 *
 * All mutation inputs are the contract request types; callers generate `id`/`operationId`
 * with crypto.randomUUID() ONCE per user intent (so retries/double-clicks are idempotent).
 */
import type {
  BloodPressureEntry,
  BloodPressurePage,
  CreateBloodPressureRequest,
  CreateIntakeRequest,
  CreateMeasurementRequest,
  CreateRoutineItemRequest,
  CreateWeightRequest,
  DashboardResponse,
  DeleteRequest,
  HistoryQuery,
  IntakeRecord,
  MeasurementPage,
  MeasurementSession,
  OccurrenceList,
  Profile,
  PutOccurrenceIntakeRequest,
  PutWeightGoalRequest,
  ReviseScheduleRequest,
  RoutineItem,
  SessionResponse,
  SignInRequest,
  SignUpRequest,
  UpdateBloodPressureRequest,
  UpdateIntakeRequest,
  UpdateMeasurementRequest,
  UpdateProfileRequest,
  UpdateRoutineItemRequest,
  UpdateWeightRequest,
  WeightEntry,
  WeightGoal,
  WeightPage,
  ApiError,
  ActivityGoal,
  ActivityToday,
  CreateWaterEntryRequest,
  HydrationGoal,
  HydrationSummary,
  PutActivityGoalRequest,
  PutHydrationGoalRequest,
  StepsSummary,
  UpdateWaterEntryRequest,
  WaterEntry,
  WaterEntryPage,
  Workout,
  WorkoutPage,
  WorkoutsQuery,
} from '@zelo/contracts';

/** Thrown by data sources for any non-2xx answer (or synthesized locally). */
export class DataError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message);
  }
  get code() {
    return this.body.code;
  }
}

/** Thrown when an operation requires network and the device is offline. */
export class OfflineError extends Error {
  constructor(message = 'Esta ação precisa de conexão com a internet.') {
    super(message);
  }
}

/**
 * Result of a mutation. `persistence` lets the UI show
 * "Salvo neste dispositivo" (local) vs "Sincronizado" (server) — never conflate them.
 */
export type Mutation<T> = { value: T; persistence: 'server' | 'local' };

export interface AuthPort {
  getSession(): Promise<SessionResponse | null>;
  signIn(input: SignInRequest): Promise<SessionResponse>;
  signUp(input: SignUpRequest): Promise<SessionResponse>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(token: string, password: string): Promise<void>;
}

export interface ZeloDataSource {
  // profile & dashboard
  getProfile(): Promise<Profile>;
  updateProfile(input: UpdateProfileRequest): Promise<Profile>; // online only
  getDashboard(date?: string): Promise<DashboardResponse>;

  // weight
  listWeights(q: HistoryQuery): Promise<WeightPage>;
  createWeight(input: CreateWeightRequest): Promise<Mutation<WeightEntry>>;
  updateWeight(id: string, input: UpdateWeightRequest): Promise<Mutation<WeightEntry>>;
  deleteWeight(id: string, input: DeleteRequest): Promise<Mutation<null>>;
  getWeightGoal(): Promise<WeightGoal | null>;
  putWeightGoal(input: PutWeightGoalRequest): Promise<WeightGoal>; // online only
  deleteWeightGoal(): Promise<void>; // online only

  // measurements
  listMeasurements(q: HistoryQuery): Promise<MeasurementPage>;
  createMeasurement(input: CreateMeasurementRequest): Promise<Mutation<MeasurementSession>>;
  updateMeasurement(id: string, input: UpdateMeasurementRequest): Promise<Mutation<MeasurementSession>>;
  deleteMeasurement(id: string, input: DeleteRequest): Promise<Mutation<null>>;

  // blood pressure
  listBloodPressure(q: HistoryQuery): Promise<BloodPressurePage>;
  createBloodPressure(input: CreateBloodPressureRequest): Promise<Mutation<BloodPressureEntry>>;
  updateBloodPressure(id: string, input: UpdateBloodPressureRequest): Promise<Mutation<BloodPressureEntry>>;
  deleteBloodPressure(id: string, input: DeleteRequest): Promise<Mutation<null>>;

  // routine (item/schedule management is online only)
  listRoutineItems(includeArchived: boolean): Promise<RoutineItem[]>;
  createRoutineItem(input: CreateRoutineItemRequest): Promise<RoutineItem>;
  updateRoutineItem(id: string, input: UpdateRoutineItemRequest): Promise<RoutineItem>;
  reviseSchedule(id: string, input: ReviseScheduleRequest): Promise<RoutineItem>;
  archiveRoutineItem(id: string, input: DeleteRequest): Promise<RoutineItem>;
  listOccurrences(date: string): Promise<OccurrenceList>;
  putOccurrenceIntake(occurrenceId: string, input: PutOccurrenceIntakeRequest): Promise<Mutation<IntakeRecord>>;
  undoOccurrenceIntake(occurrenceId: string, input: DeleteRequest): Promise<Mutation<null>>;
  createIntake(input: CreateIntakeRequest): Promise<Mutation<IntakeRecord>>;
  listIntakes(q: HistoryQuery): Promise<{ items: IntakeRecord[]; nextCursor: string | null }>;
  updateIntake(id: string, input: UpdateIntakeRequest): Promise<IntakeRecord>;
  deleteIntake(id: string, input: DeleteRequest): Promise<void>;

  // hydration (entries work offline through the existing queue; goal is online only)
  listWaterEntries(q: HistoryQuery): Promise<WaterEntryPage>;
  createWaterEntry(input: CreateWaterEntryRequest): Promise<Mutation<WaterEntry>>;
  updateWaterEntry(id: string, input: UpdateWaterEntryRequest): Promise<Mutation<WaterEntry>>;
  deleteWaterEntry(id: string, input: DeleteRequest): Promise<Mutation<null>>;
  /** from/to: inclusive local dates (profile tz) */
  getHydrationSummary(from: string, to: string): Promise<HydrationSummary>;
  getHydrationGoal(): Promise<HydrationGoal | null>;
  putHydrationGoal(input: PutHydrationGoalRequest): Promise<HydrationGoal>; // online only
  deleteHydrationGoal(): Promise<void>; // online only

  // activity — READ-ONLY data received from Health Auto Export (served from cache offline when available)
  getActivityToday(date?: string): Promise<ActivityToday>;
  getStepsSummary(from: string, to: string): Promise<StepsSummary>;
  listWorkouts(q: WorkoutsQuery): Promise<WorkoutPage>;
  getWorkout(id: string): Promise<Workout>;
  getActivityGoal(): Promise<ActivityGoal | null>;
  putActivityGoal(input: PutActivityGoalRequest): Promise<ActivityGoal>; // online only
  deleteActivityGoal(): Promise<void>; // online only

  /** Called after any successful mutation so hooks can refetch. Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Sync status shown in the UI (spec §9). Provided by the offline layer; HTTP-only impl returns a static value. */
export interface SyncStatus {
  online: boolean;
  offlineEnabled: boolean;
  lastSyncedAt: string | null;
  pendingCount: number;
  conflictCount: number;
  errorCount: number;
  syncing: boolean;
  /** true when a 401 paused the queue and login is required */
  needsReauth: boolean;
}

export interface SyncPort {
  getStatus(): SyncStatus;
  subscribeStatus(listener: (s: SyncStatus) => void): () => void;
  syncNow(): Promise<void>;
  enableOffline(): Promise<void>;
  disableOffline(): Promise<void>;
  /** pending/conflict/error operations for the conflict-resolution UI */
  listProblemOperations(): Promise<QueuedOperationView[]>;
  /** keep server version: drops the local operation */
  resolveKeepRemote(operationId: string): Promise<void>;
  /** re-apply local edit on top of the current server version */
  resolveReapplyLocal(operationId: string): Promise<void>;
  discardOperation(operationId: string): Promise<void>;
  /** wipes all personal local data for the current account (logout/account switch) */
  clearLocalData(): Promise<void>;
}

export interface QueuedOperationView {
  operationId: string;
  type: string;
  entityId: string;
  state: 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';
  createdAt: string;
  localPayload: unknown;
  remote?: unknown;
  error?: ApiError;
}
