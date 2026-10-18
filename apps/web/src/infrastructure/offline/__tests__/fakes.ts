import type {
  Occurrence,
  Profile,
  SessionResponse,
  SyncChange,
  SyncOperation,
  SyncOperationResult,
  WeightEntry,
  IntakeRecord,
  WaterEntry,
  HydrationGoal,
  DailySteps,
  ActivityGoal,
  Workout,
} from '@zelo/contracts';
import { DataError, OfflineError, type AuthPort, type Mutation, type ZeloDataSource } from '@/shared/data/ports';
import type { SyncApi } from '../api';
import type { KeyValueStorage } from '../flags';

export const U1 = '11111111-1111-4111-8111-111111111111';
export const U2 = '22222222-2222-4222-8222-222222222222';

export const uuid = () => crypto.randomUUID();

export function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

export const session = (userId: string): SessionResponse => ({
  user: { userId, email: `${userId.slice(0, 4)}@example.com` },
  expiresAt: '2030-01-01T00:00:00.000Z',
});

const err = (status: number, code: DataError['body']['code'], extra: Partial<DataError['body']> = {}) => ({
  code,
  message: code,
  correlationId: 'test',
  ...extra,
});

/** In-memory server with idempotency, versions and a per-user change log. */
export class FakeServer {
  online = true;
  sessionUser: string | null = U1;
  weights = new Map<string, WeightEntry>();
  occurrences = new Map<string, Occurrence>();
  water = new Map<string, WaterEntry>();
  hydrationGoal: HydrationGoal | null = null;
  steps = new Map<string, DailySteps>();
  workouts = new Map<string, Workout>();
  activityGoal: ActivityGoal | null = null;
  /** calls made to the (online-only) HTTP reads/writes of the new modules */
  httpCalls: string[] = [];
  log: Array<{ seq: number; change: SyncChange }> = [];
  seq = 0;
  idem = new Map<string, { payload: string; result: SyncOperationResult }>();
  operationCalls: SyncOperation[][] = [];
  applied = 0;
  /** next /sync/operations call: process then drop the response */
  loseNextResponse = false;
  /** next /sync/operations answer for every op */
  forceStatus: number | null = null;
  signOutCalls = 0;
  pushDeletes: string[] = [];

  profile(): Profile {
    return {
      userId: this.sessionUser ?? U1,
      displayName: 'Ana',
      timezone: 'America/Sao_Paulo',
      visibleModules: ['body', 'bloodPressure', 'routine'],
      remindersEnabled: true,
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  private bump(change: SyncChange) {
    this.log.push({ seq: ++this.seq, change });
  }

  /** "other device" edits */
  upsertWeight(w: WeightEntry) {
    this.weights.set(w.id, w);
    this.bump({ op: 'upsert', entity: 'weightEntry', id: w.id, data: w });
  }
  deleteWeight(id: string) {
    this.weights.delete(id);
    this.bump({ op: 'delete', entity: 'weightEntry', id });
  }

  upsertWater(w: WaterEntry) {
    this.water.set(w.id, w);
    this.bump({ op: 'upsert', entity: 'waterEntry', id: w.id, data: w });
  }
  deleteWater(id: string) {
    this.water.delete(id);
    this.bump({ op: 'delete', entity: 'waterEntry', id });
  }
  /** activity "received from the iPhone" (server side import) */
  receiveSteps(s: DailySteps) {
    this.steps.set(s.id, s);
    this.bump({ op: 'upsert', entity: 'dailySteps', id: s.id, data: s });
  }
  receiveWorkout(w: Workout) {
    this.workouts.set(w.id, w);
    this.bump({ op: 'upsert', entity: 'workout', id: w.id, data: w });
  }
  deleteWorkout(id: string) {
    this.workouts.delete(id);
    this.bump({ op: 'delete', entity: 'workout', id });
  }
  /** a change for an entity this client does not know (newer server) */
  unknownChange() {
    this.bump({ op: 'upsert', entity: 'somethingNew' as never, id: 'x', data: { id: 'x' } });
  }

  process(op: SyncOperation): SyncOperationResult {
    const p = op.payload as { operationId: string; expectedVersion?: number } & Record<string, unknown>;
    const key = JSON.stringify(p);
    const prev = this.idem.get(p.operationId);
    if (prev) {
      if (prev.payload !== key) return { operationId: p.operationId, status: 409, error: err(409, 'IDEMPOTENCY_CONFLICT') };
      return prev.result;
    }
    const result = this.apply(op, p);
    if (result.status < 500) this.idem.set(p.operationId, { payload: key, result });
    return result;
  }

  private apply(op: SyncOperation, p: { operationId: string; expectedVersion?: number } & Record<string, unknown>): SyncOperationResult {
    const id = op.entityId;
    const now = new Date().toISOString();
    const ok = (body: unknown, status = 200): SyncOperationResult => {
      this.applied++;
      return { operationId: p.operationId, status, body };
    };
    switch (op.type) {
      case 'weight.create': {
        if (typeof p.weightKg !== 'string' || !/^\d+(\.\d{1,2})?$/.test(p.weightKg))
          return { operationId: p.operationId, status: 422, error: err(422, 'VALIDATION_ERROR') };
        const w: WeightEntry = {
          id,
          version: 1,
          createdAt: now,
          updatedAt: now,
          measuredAt: p.measuredAt as string,
          timezone: p.timezone as string,
          weightKg: p.weightKg,
          notes: (p.notes as string | null | undefined) ?? null,
          deltaKg: null,
        };
        this.upsertWeight(w);
        return ok(w, 201);
      }
      case 'weight.update': {
        const cur = this.weights.get(id);
        if (!cur) return { operationId: p.operationId, status: 404, error: err(404, 'NOT_FOUND') };
        if (cur.version !== p.expectedVersion)
          return { operationId: p.operationId, status: 409, error: err(409, 'VERSION_CONFLICT', { current: cur }) };
        const { operationId: _o, expectedVersion: _e, ...fields } = p;
        void _o;
        void _e;
        const next = { ...cur, ...fields, version: cur.version + 1, updatedAt: now } as WeightEntry;
        this.upsertWeight(next);
        return ok(next);
      }
      case 'weight.delete': {
        const cur = this.weights.get(id);
        if (!cur) return { operationId: p.operationId, status: 404, error: err(404, 'NOT_FOUND') };
        if (cur.version !== p.expectedVersion)
          return { operationId: p.operationId, status: 409, error: err(409, 'VERSION_CONFLICT', { current: cur }) };
        this.deleteWeight(id);
        return ok(undefined, 204);
      }
      case 'occurrence.intake.put': {
        const occ = this.occurrences.get(id)!;
        if (occ.intake && occ.intake.version !== p.expectedVersion)
          return { operationId: p.operationId, status: 409, error: err(409, 'VERSION_CONFLICT', { current: occ.intake }) };
        const rec: IntakeRecord = {
          id: occ.intake?.id ?? (p.intakeId as string),
          version: (occ.intake?.version ?? 0) + 1,
          createdAt: now,
          updatedAt: now,
          itemId: occ.itemId,
          occurrenceId: occ.id,
          status: p.status as IntakeRecord['status'],
          actualTakenAt: p.actualTakenAt as string | null,
          notes: null,
          nameSnapshot: occ.nameSnapshot,
          doseSnapshot: occ.doseSnapshot,
          unitSnapshot: occ.unitSnapshot,
        };
        this.occurrences.set(id, { ...occ, intake: rec, state: rec.status });
        this.bump({ op: 'upsert', entity: 'intakeRecord', id: rec.id, data: rec });
        return ok(rec);
      }
      case 'water.create': {
        if (this.water.has(id)) return { operationId: p.operationId, status: 409, error: err(409, 'IDEMPOTENCY_CONFLICT') };
        const w: WaterEntry = {
          id,
          version: 1,
          createdAt: now,
          updatedAt: now,
          consumedAt: p.consumedAt as string,
          timezone: p.timezone as string,
          amountMl: p.amountMl as number,
          notes: (p.notes as string | null | undefined) ?? null,
        };
        this.upsertWater(w);
        return ok(w, 201);
      }
      case 'water.update': {
        const cur = this.water.get(id);
        if (!cur) return { operationId: p.operationId, status: 404, error: err(404, 'NOT_FOUND') };
        if (cur.version !== p.expectedVersion)
          return { operationId: p.operationId, status: 409, error: err(409, 'VERSION_CONFLICT', { current: cur }) };
        const { operationId: _o, expectedVersion: _e, ...fields } = p;
        void _o;
        void _e;
        const next = { ...cur, ...fields, version: cur.version + 1, updatedAt: now } as WaterEntry;
        this.upsertWater(next);
        return ok(next);
      }
      case 'water.delete': {
        const cur = this.water.get(id);
        if (!cur) return { operationId: p.operationId, status: 404, error: err(404, 'NOT_FOUND') };
        if (cur.version !== p.expectedVersion)
          return { operationId: p.operationId, status: 409, error: err(409, 'VERSION_CONFLICT', { current: cur }) };
        this.deleteWater(id);
        return ok(undefined, 204);
      }
      default:
        return { operationId: p.operationId, status: 400, error: err(400, 'VALIDATION_ERROR') };
    }
  }

  private guard() {
    if (!this.online) throw new OfflineError();
    if (!this.sessionUser) throw new DataError(401, err(401, 'UNAUTHENTICATED'));
  }

  api: SyncApi = {
    bootstrap: async () => {
      this.guard();
      return {
        cursor: String(this.seq),
        profile: this.profile(),
        weightEntries: [...this.weights.values()],
        weightGoal: null,
        measurementSessions: [],
        bloodPressureEntries: [],
        routineItems: [],
        occurrences: [...this.occurrences.values()],
        intakeRecords: [],
        waterEntries: [...this.water.values()],
        hydrationGoal: this.hydrationGoal,
        dailySteps: [...this.steps.values()],
        activityGoal: this.activityGoal,
        workouts: [...this.workouts.values()],
      };
    },
    changes: async (cursor) => {
      this.guard();
      const n = Number(cursor);
      return { changes: this.log.filter((l) => l.seq > n).map((l) => l.change), cursor: String(this.seq), hasMore: false };
    },
    operations: async (ops) => {
      this.guard();
      this.operationCalls.push(ops.map((o) => structuredClone(o)));
      if (this.forceStatus) {
        const s = this.forceStatus;
        return { results: ops.map((o) => ({ operationId: (o.payload as { operationId: string }).operationId, status: s, error: err(s, s === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR') })) };
      }
      const results = ops.map((o) => this.process(o));
      if (this.loseNextResponse) {
        this.loseNextResponse = false;
        throw new OfflineError();
      }
      return { results };
    },
    pushConfig: async () => ({ vapidPublicKey: null }),
    pushSubscribe: async () => ({ id: uuid(), deviceId: uuid(), createdAt: new Date().toISOString() }),
    pushUnsubscribe: async (id) => {
      this.guard();
      this.pushDeletes.push(id);
    },
  };

  auth: AuthPort = {
    getSession: async () => {
      if (!this.online) throw new OfflineError();
      return this.sessionUser ? session(this.sessionUser) : null;
    },
    signIn: async (input) => {
      if (!this.online) throw new OfflineError();
      this.sessionUser = input.email.startsWith('2222') ? U2 : U1;
      return session(this.sessionUser);
    },
    signUp: async () => {
      throw new Error('not used');
    },
    signOut: async () => {
      if (!this.online) throw new OfflineError();
      this.signOutCalls++;
      this.sessionUser = null;
    },
    requestPasswordReset: async () => undefined,
    confirmPasswordReset: async () => undefined,
  };

  /** HttpDataSource fake: direct (online) mutations go through the same idempotent processor. */
  http(): ZeloDataSource {
    const call = async <T>(op: SyncOperation): Promise<Mutation<T>> => {
      this.guard();
      const r = this.process(op);
      if (r.status >= 300) throw new DataError(r.status, r.error!);
      return { value: (r.body ?? null) as T, persistence: 'server' };
    };
    const notUsed = async (): Promise<never> => {
      throw new Error('not used in tests');
    };
    return {
      getProfile: async () => this.profile(),
      updateProfile: notUsed,
      getDashboard: notUsed,
      listWeights: async () => ({ items: [...this.weights.values()], nextCursor: null }),
      createWeight: (input) => call({ type: 'weight.create', entityId: input.id, payload: input }),
      updateWeight: (id, input) => call({ type: 'weight.update', entityId: id, payload: input }),
      deleteWeight: (id, input) => call({ type: 'weight.delete', entityId: id, payload: input }),
      getWeightGoal: async () => null,
      putWeightGoal: notUsed,
      deleteWeightGoal: notUsed,
      listMeasurements: notUsed,
      createMeasurement: notUsed,
      updateMeasurement: notUsed,
      deleteMeasurement: notUsed,
      listBloodPressure: notUsed,
      createBloodPressure: notUsed,
      updateBloodPressure: notUsed,
      deleteBloodPressure: notUsed,
      listRoutineItems: async () => [],
      createRoutineItem: notUsed,
      updateRoutineItem: notUsed,
      reviseSchedule: notUsed,
      archiveRoutineItem: notUsed,
      listOccurrences: async (date) => {
        this.guard();
        return { date, items: [...this.occurrences.values()].filter((o) => o.localDate === date) };
      },
      putOccurrenceIntake: (id, input) => call({ type: 'occurrence.intake.put', entityId: id, payload: input }),
      undoOccurrenceIntake: notUsed,
      createIntake: notUsed,
      listIntakes: notUsed,
      updateIntake: notUsed,
      deleteIntake: notUsed,
      listWaterEntries: async () => {
        this.guard();
        this.httpCalls.push('listWaterEntries');
        return { items: [...this.water.values()], nextCursor: null };
      },
      createWaterEntry: (input) => call({ type: 'water.create', entityId: input.id, payload: input }),
      updateWaterEntry: (id, input) => call({ type: 'water.update', entityId: id, payload: input }),
      deleteWaterEntry: (id, input) => call({ type: 'water.delete', entityId: id, payload: input }),
      getHydrationSummary: async (from, to) => {
        this.guard();
        this.httpCalls.push('getHydrationSummary');
        return { timezone: 'America/Sao_Paulo', from, to, days: [], goal: this.hydrationGoal, averageMlOnRecordedDays: null };
      },
      getHydrationGoal: async () => {
        this.guard();
        this.httpCalls.push('getHydrationGoal');
        return this.hydrationGoal;
      },
      putHydrationGoal: async (input) => {
        this.guard();
        this.httpCalls.push('putHydrationGoal');
        this.hydrationGoal = { dailyTargetMl: input.dailyTargetMl, version: (this.hydrationGoal?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
        this.bump({ op: 'upsert', entity: 'hydrationGoal', id: 'current', data: this.hydrationGoal });
        return this.hydrationGoal;
      },
      deleteHydrationGoal: async () => {
        this.guard();
        this.httpCalls.push('deleteHydrationGoal');
        this.hydrationGoal = null;
      },
      getActivityToday: async (date) => {
        this.guard();
        this.httpCalls.push('getActivityToday');
        const d = date ?? '2026-10-18';
        return { date: d, steps: { date: d, count: null, partial: true, receivedAt: null }, stepsGoal: null, workoutCount: 0, workoutSeconds: 0, lastReceivedAt: null };
      },
      getStepsSummary: async (from, to) => {
        this.guard();
        this.httpCalls.push('getStepsSummary');
        return { from, to, days: [], goal: null, averageOnDaysWithData: null, lastReceivedAt: null };
      },
      listWorkouts: async () => {
        this.guard();
        this.httpCalls.push('listWorkouts');
        return { items: [...this.workouts.values()], nextCursor: null, availableNames: [] };
      },
      getWorkout: async (id) => {
        this.guard();
        this.httpCalls.push('getWorkout');
        const w = this.workouts.get(id);
        if (!w) throw new DataError(404, err(404, 'NOT_FOUND'));
        return w;
      },
      getActivityGoal: async () => {
        this.guard();
        this.httpCalls.push('getActivityGoal');
        return this.activityGoal;
      },
      putActivityGoal: async (input) => {
        this.guard();
        this.httpCalls.push('putActivityGoal');
        this.activityGoal = { dailyStepsTarget: input.dailyStepsTarget, version: 1, updatedAt: new Date().toISOString() };
        return this.activityGoal;
      },
      deleteActivityGoal: async () => {
        this.guard();
        this.httpCalls.push('deleteActivityGoal');
        this.activityGoal = null;
      },
      subscribe: () => () => undefined,
    };
  }
}

export const weightInput = (weightKg = '82.35', measuredAt = '2026-10-10T10:00:00.000Z') => ({
  operationId: uuid(),
  id: uuid(),
  measuredAt,
  timezone: 'America/Sao_Paulo',
  weightKg,
});

export const waterInput = (amountMl = 300, consumedAt = '2026-10-18T12:00:00.000Z') => ({
  operationId: uuid(),
  id: uuid(),
  consumedAt,
  timezone: 'America/Sao_Paulo',
  amountMl,
});

export const steps = (localDate: string, count: number, receivedAt = `${localDate}T23:00:00.000Z`): DailySteps => ({
  id: uuid(),
  provider: 'health-auto-export',
  localDate,
  count,
  offsetMinutes: -180,
  receivedAt,
  createdAt: receivedAt,
});

export const workout = (name: string, startedAt: string, localDate: string, durationSeconds = 1800, receivedAt = '2026-10-18T12:00:00.000Z'): Workout => ({
  id: uuid(),
  provider: 'health-auto-export',
  name,
  startedAt,
  endedAt: new Date(Date.parse(startedAt) + durationSeconds * 1000).toISOString(),
  startOffsetMinutes: -180,
  localDate,
  durationSeconds,
  distanceMeters: null,
  activeEnergyKcal: null,
  receivedAt,
  createdAt: receivedAt,
});
