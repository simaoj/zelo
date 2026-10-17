/**
 * Offline-first data layer (spec §9).
 *
 *  - Offline is OPT-IN per device (DeviceFlags.offlineEnabled). Disabled → pure passthrough to
 *    HTTP and nothing personal is stored locally.
 *  - Enabled → per-account Dexie DB `zelo-<userId>` replicated via /sync/bootstrap + /sync/changes.
 *    Reads are served from IndexedDB. Allowed mutations (weight/measurement/BP CRUD, occurrence
 *    intake put/undo, ad-hoc intake) go straight to the server when online and nothing is queued
 *    for that entity; otherwise they are written locally + queued in ONE transaction
 *    ({persistence:'local'}). Everything else requires network (OfflineError).
 *  - Queue is pushed in order (one op per entity per round, chained ops rebased on the
 *    server-confirmed version), confirmed only after the server answers.
 */
import type {
  CreateBloodPressureRequest,
  CreateIntakeRequest,
  CreateMeasurementRequest,
  CreateWeightRequest,
  DashboardResponse,
  DeleteRequest,
  HistoryQuery,
  IntakeRecord,
  Occurrence,
  OccurrenceList,
  Profile,
  PutOccurrenceIntakeRequest,
  RoutineItem,
  SessionResponse,
  SignInRequest,
  SignUpRequest,
  SyncOperation,
  SyncOperationType,
  UpdateBloodPressureRequest,
  UpdateMeasurementRequest,
  UpdateWeightRequest,
  WeightGoal,
} from '@zelo/contracts';
import {
  DataError,
  OfflineError,
  type AuthPort,
  type Mutation,
  type QueuedOperationView,
  type SyncPort,
  type SyncStatus,
  type ZeloDataSource,
} from '@/shared/data/ports';
import { createFetchSyncApi, type SyncApi } from './api';
import { ZeloDb, deleteUserDb, type QueuedOperation } from './db';
import { DeviceFlags, type KeyValueStorage } from './flags';
import { composeDashboard, localDateIn, pageLocal, withDeltas, withDerivedState } from './local-queries';
import {
  UNSYNCED_STATES,
  applyBootstrap,
  applyChange,
  applyLocalEdit,
  applyRemoteSnapshot,
  applyServerResult,
  currentLocalVersion,
  dataTables,
  entityHasUnsynced,
  unsyncedOps,
  validateOperation,
} from './store';

export type SignOutChoice = 'sync' | 'cancel' | 'discard';
export interface SignOutPrompt {
  pendingCount: number;
  online: boolean;
  /** true when the user already chose "Sincronizar e sair" and some operations are still pending */
  syncFailed: boolean;
}
export type SignOutHandler = (prompt: SignOutPrompt) => Promise<SignOutChoice>;

/** Thrown by the wrapped signOut when the user cancels (UI must stay signed in). */
export class SignOutCancelledError extends Error {
  constructor() {
    super('Saída cancelada.');
    this.name = 'SignOutCancelledError';
  }
}
export const isSignOutCancelled = (e: unknown): e is SignOutCancelledError => e instanceof SignOutCancelledError;

export interface OfflineLayerOptions {
  api?: SyncApi;
  storage?: KeyValueStorage;
  isOnline?: () => boolean;
  now?: () => Date;
  random?: () => number;
  /** sync automatically after local writes / on triggers (default true) */
  autoSync?: boolean;
  /** install window/SW listeners (default: in a browser) */
  installListeners?: boolean;
  /** remove this device's Web Push subscription in the browser (default: navigator.serviceWorker) */
  unsubscribeBrowserPush?: () => Promise<void>;
}

/** Extra capabilities of the offline SyncPort used by the PWA components. */
export interface OfflineSyncPort extends SyncPort {
  readonly isOfflineSync: true;
  setSignOutHandler(handler: SignOutHandler | null): void;
  /** data of a different account still on this device with unsynced operations */
  getForeignAccount(): { userId: string; email: string; pendingCount: number } | null;
  discardForeignAccountData(): Promise<void>;
  pushApi(): SyncApi;
  flags(): DeviceFlags;
  dispose(): void;
}
export const isOfflineSync = (s: SyncPort | undefined | null): s is OfflineSyncPort =>
  !!s && (s as Partial<OfflineSyncPort>).isOfflineSync === true;

const ALLOWED_OFFLINE: ReadonlySet<SyncOperationType> = new Set<SyncOperationType>([
  'weight.create',
  'weight.update',
  'weight.delete',
  'measurement.create',
  'measurement.update',
  'measurement.delete',
  'bloodPressure.create',
  'bloodPressure.update',
  'bloodPressure.delete',
  'occurrence.intake.put',
  'occurrence.intake.delete',
  'intake.create',
]);

const BATCH_MAX = 100;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

export class OfflineRuntime {
  readonly flags: DeviceFlags;
  readonly api: SyncApi;
  readonly isOnline: () => boolean;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly autoSync: boolean;
  private db: ZeloDb | null = null;
  private sessionUserId: string | null = null;
  private foreign: { userId: string; email: string; pendingCount: number } | null = null;
  private status: SyncStatus;
  private statusListeners = new Set<(s: SyncStatus) => void>();
  private dataListeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private rerun = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private signOutHandler: SignOutHandler | null = null;
  private cleanup: Array<() => void> = [];

  constructor(
    readonly http: ZeloDataSource,
    readonly rawAuth: AuthPort,
    private readonly opts: OfflineLayerOptions = {},
  ) {
    this.flags = new DeviceFlags(opts.storage);
    this.api = opts.api ?? createFetchSyncApi();
    this.isOnline = opts.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
    this.now = opts.now ?? (() => new Date());
    this.random = opts.random ?? Math.random;
    this.autoSync = opts.autoSync ?? true;
    this.status = {
      online: this.isOnline(),
      offlineEnabled: this.flags.offlineEnabled,
      lastSyncedAt: null,
      pendingCount: 0,
      conflictCount: 0,
      errorCount: 0,
      syncing: false,
      needsReauth: false,
    };
    const install = opts.installListeners ?? typeof window !== 'undefined';
    if (install) this.installListeners();
    void this.refreshStatus();
  }

  // ---------------- status ----------------

  getStatus = () => this.status;

  subscribeStatus = (l: (s: SyncStatus) => void) => {
    this.statusListeners.add(l);
    return () => void this.statusListeners.delete(l);
  };

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const l of this.statusListeners) l(this.status);
  }

  async refreshStatus() {
    const db = await this.openDb();
    if (!db) {
      this.setStatus({ online: this.isOnline(), offlineEnabled: this.flags.offlineEnabled, pendingCount: 0, conflictCount: 0, errorCount: 0 });
      return;
    }
    const ops = await unsyncedOps(db);
    const last = await db.meta.get('lastSyncedAt');
    this.setStatus({
      online: this.isOnline(),
      offlineEnabled: true,
      lastSyncedAt: (last?.value as string | undefined) ?? null,
      pendingCount: ops.filter((o) => o.state === 'pending' || o.state === 'syncing').length,
      conflictCount: ops.filter((o) => o.state === 'conflict').length,
      errorCount: ops.filter((o) => o.state === 'error').length,
    });
  }

  emitData() {
    for (const l of this.dataListeners) l();
  }
  subscribeData(l: () => void) {
    this.dataListeners.add(l);
    return () => void this.dataListeners.delete(l);
  }

  // ---------------- DB lifecycle ----------------

  /** DB of the account whose data is on this device, if offline is enabled and it is the current session. */
  async openDb(): Promise<ZeloDb | null> {
    if (!this.flags.offlineEnabled) return null;
    const owner = this.flags.identity?.user.userId;
    if (!owner) return null;
    if (this.sessionUserId && this.sessionUserId !== owner) return null; // never expose another account's data
    if (this.db?.userId === owner) return this.db;
    this.db?.close();
    const db = new ZeloDb(owner);
    // crash recovery: anything left "syncing" is re-sent with the same operationId (idempotent)
    await db.operations.where('state').equals('syncing').modify({ state: 'pending' });
    this.db = db;
    return db;
  }

  /** DB ready for local reads (bootstrapped). */
  async readyDb(): Promise<ZeloDb | null> {
    const db = await this.openDb();
    if (!db) return null;
    const cursor = await db.meta.get('cursor');
    return cursor ? db : null;
  }

  private async wipeDb(userId: string) {
    if (this.db?.userId === userId) {
      this.db.close();
      this.db = null;
    }
    await deleteUserDb(userId);
  }

  // ---------------- triggers ----------------

  private installListeners() {
    const onOnline = () => {
      this.setStatus({ online: true });
      void this.tryRevoke().then(() => this.trigger());
    };
    const onOffline = () => this.setStatus({ online: false });
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.trigger();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    this.cleanup.push(
      () => window.removeEventListener('online', onOnline),
      () => window.removeEventListener('offline', onOffline),
      () => document.removeEventListener('visibilitychange', onVisible),
    );
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const onMsg = (e: MessageEvent) => {
        if ((e.data as { type?: string } | null)?.type === 'SYNC_REQUESTED') this.trigger();
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      this.cleanup.push(() => navigator.serviceWorker.removeEventListener('message', onMsg));
    }
    // sync on app open
    setTimeout(() => {
      void this.tryRevoke().then(() => this.trigger());
    }, 0);
  }

  dispose() {
    for (const c of this.cleanup.splice(0)) c();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.db?.close();
    this.db = null;
  }

  trigger() {
    if (!this.autoSync || !this.flags.offlineEnabled) return;
    void this.syncNow().catch(() => undefined);
  }

  private requestBackgroundSync() {
    try {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
      void navigator.serviceWorker.ready
        .then((r) => (r as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }).sync?.register('zelo-sync'))
        .catch(() => undefined);
    } catch {
      /* optional optimisation only */
    }
  }

  private scheduleRetry() {
    if (!this.autoSync) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, this.failures - 1));
    const delay = Math.round(exp * (0.7 + this.random() * 0.6));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.trigger();
    }, delay);
  }

  /** Exposed for tests/UI. */
  backoffDelayFor(failures: number, rnd = 0.5) {
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
    return Math.round(exp * (0.7 + rnd * 0.6));
  }

  // ---------------- sync ----------------

  syncNow = (): Promise<void> => {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.runSync();
        } while (this.rerun);
      } finally {
        this.running = null;
        this.setStatus({ syncing: false });
        await this.refreshStatus();
      }
    })();
    return this.running;
  };

  private async runSync() {
    if (!this.flags.offlineEnabled) return;
    if (!this.isOnline()) {
      this.setStatus({ online: false });
      return;
    }
    if (!(await this.tryRevoke())) return;
    let session: SessionResponse | null;
    try {
      session = await this.rawAuth.getSession();
    } catch (e) {
      if (e instanceof OfflineError) return this.setStatus({ online: false });
      if (e instanceof DataError && e.status === 401) session = null;
      else throw e;
    }
    if (!session) {
      this.setStatus({ needsReauth: true });
      return;
    }
    await this.adoptSession(session);
    const db = await this.openDb();
    if (!db) return; // other account's data (foreign) — never sent with this session
    this.setStatus({ syncing: true, online: true, needsReauth: false });
    const cursor = await db.meta.get('cursor');
    const force = await db.meta.get('forceBootstrap');
    if (!cursor || force?.value) {
      await this.bootstrap(db);
      await db.meta.delete('forceBootstrap');
    }
    const pushed = await this.push(db, session.user.userId);
    if (pushed === 'reauth' || pushed === 'offline') return;
    await this.pull(db);
    if (pushed === 'ok') this.failures = 0;
    await db.meta.put({ key: 'lastSyncedAt', value: this.now().toISOString() });
    this.emitData();
  }

  private async keepIds(db: ZeloDb) {
    return new Set((await unsyncedOps(db)).map((o) => o.entityId));
  }

  private async bootstrap(db: ZeloDb) {
    const b = await this.api.bootstrap();
    await applyBootstrap(db, b, await this.keepIds(db));
    this.emitData();
  }

  private async pull(db: ZeloDb) {
    for (let i = 0; i < 1000; i++) {
      const cursor = (await db.meta.get('cursor'))?.value as string | undefined;
      if (!cursor) return this.bootstrap(db);
      let res;
      try {
        res = await this.api.changes(cursor);
      } catch (e) {
        if (e instanceof DataError && [400, 404, 410].includes(e.status)) return this.bootstrap(db); // cursor no longer valid
        if (e instanceof OfflineError) return;
        throw e;
      }
      const pending = await this.keepIds(db);
      await db.transaction('rw', dataTables(db), async () => {
        let touchedWeights = false;
        for (const c of res.changes) {
          await applyChange(db, c, pending);
          if (c.entity === 'weightEntry') touchedWeights = true;
        }
        if (touchedWeights) await db.weightEntries.bulkPut(withDeltas(await db.weightEntries.toArray()));
        await db.meta.put({ key: 'cursor', value: res.cursor });
      });
      if (res.changes.length) this.emitData();
      if (!res.hasMore) return;
    }
  }

  /** Pushes queued operations. One op per entity per round so chained ops can be rebased. */
  private async push(db: ZeloDb, sessionUserId: string): Promise<'ok' | 'transient' | 'reauth' | 'offline'> {
    for (let round = 0; round < 10_000; round++) {
      const ops = await unsyncedOps(db);
      const blocked = new Set<string>();
      const batch: QueuedOperation[] = [];
      for (const op of ops) {
        if (op.ownerUserId !== sessionUserId) {
          // never sync one account's queue with another account's session
          blocked.add(op.entityId);
          continue;
        }
        if (blocked.has(op.entityId)) continue;
        blocked.add(op.entityId); // only the first unsynced op of each entity this round
        if (op.state !== 'pending' && op.state !== 'syncing') continue; // conflict/error block the entity
        if (batch.length < BATCH_MAX) batch.push(op);
      }
      if (!batch.length) return 'ok';

      // rebase chained ops on the confirmed server version, then mark syncing
      const wire: SyncOperation[] = [];
      await db.transaction('rw', dataTables(db), async () => {
        for (const op of batch) {
          if (op.chained) {
            const v = await currentLocalVersion(db, op);
            const payload = { ...op.payload };
            if (v === null) delete payload.expectedVersion;
            else if ('expectedVersion' in payload || op.type.endsWith('.update') || op.type.endsWith('.delete')) payload.expectedVersion = v;
            op.payload = payload;
            op.expectedVersion = v;
            op.chained = false;
          }
          op.state = 'syncing';
          await db.operations.put(op);
          wire.push({ type: op.type, entityId: op.entityId, payload: op.payload } as SyncOperation);
        }
      });
      this.setStatus({ syncing: true });

      let results;
      try {
        results = (await this.api.operations(wire)).results;
      } catch (e) {
        await this.revert(db, batch);
        if (e instanceof OfflineError) {
          this.setStatus({ online: this.isOnline() });
          this.failures++;
          if (this.isOnline()) this.scheduleRetry();
          return 'offline';
        }
        if (e instanceof DataError && e.status === 401) {
          this.setStatus({ needsReauth: true });
          return 'reauth';
        }
        if (e instanceof DataError && (e.status === 429 || e.status >= 500)) {
          this.failures++;
          this.scheduleRetry();
          return 'transient';
        }
        if (e instanceof DataError) {
          await db.operations.bulkPut(batch.map((o) => ({ ...o, state: 'error' as const, lastError: e.body, attempts: o.attempts + 1 })));
          continue;
        }
        throw e;
      }

      const byId = new Map(results.map((r) => [r.operationId, r]));
      let outcome: 'ok' | 'transient' | 'reauth' = 'ok';
      for (const op of batch) {
        const r = byId.get(op.operationId);
        if (!r || outcome !== 'ok') {
          await db.operations.update(op.seq!, { state: 'pending' });
          continue;
        }
        if (r.status >= 200 && r.status < 300) {
          await db.transaction('rw', dataTables(db), async () => {
            await applyServerResult(db, op.type, op.entityId, r.body ?? null);
            await db.operations.update(op.seq!, { state: 'synced', lastError: null, attempts: op.attempts + 1 });
          });
        } else if (r.status === 401) {
          outcome = 'reauth';
          await db.operations.update(op.seq!, { state: 'pending' });
        } else if (r.status === 429 || r.status >= 500) {
          outcome = 'transient';
          await db.operations.update(op.seq!, { state: 'pending', attempts: op.attempts + 1, lastError: r.error ?? null });
        } else if (r.status === 409 && r.error?.code === 'VERSION_CONFLICT') {
          await db.operations.update(op.seq!, { state: 'conflict', remote: r.error.current ?? null, lastError: r.error, attempts: op.attempts + 1 });
        } else {
          // 400/422 validation, 404, 403, IDEMPOTENCY_CONFLICT → visible error for correction
          await db.operations.update(op.seq!, {
            state: 'error',
            attempts: op.attempts + 1,
            lastError: r.error ?? { code: 'INTERNAL_ERROR', message: 'Erro ao sincronizar.', correlationId: 'local' },
          });
        }
      }
      await db.operations.where('state').equals('synced').delete();
      this.emitData();
      await this.refreshStatus();
      if (outcome === 'reauth') {
        this.setStatus({ needsReauth: true });
        return 'reauth';
      }
      if (outcome === 'transient') {
        this.failures++;
        this.scheduleRetry();
        return 'transient';
      }
    }
    return 'ok';
  }

  private async revert(db: ZeloDb, batch: QueuedOperation[]) {
    await db.operations.bulkPut(batch.map((o) => ({ ...o, state: 'pending' as const })));
  }

  // ---------------- local mutations ----------------

  async mutate<T>(type: SyncOperationType, entityId: string, payload: Record<string, unknown> & { operationId: string }, remote: () => Promise<Mutation<T>>): Promise<Mutation<T>> {
    const db = await this.readyDb();
    if (!db) return remote();
    if (!ALLOWED_OFFLINE.has(type)) throw new OfflineError();

    if (this.isOnline() && !this.status.needsReauth && !(await entityHasUnsynced(db, entityId))) {
      try {
        const res = await remote();
        await db.transaction('rw', dataTables(db), () => applyServerResult(db, type, entityId, res.value));
        this.emitData();
        return res;
      } catch (e) {
        if (!(e instanceof OfflineError)) throw e;
        // network failure: fall through and queue with the SAME operationId (server is idempotent)
      }
    }

    validateOperation(type, entityId, payload);
    let value: unknown;
    await db.transaction('rw', dataTables(db), async () => {
      const already = await db.operations.where('operationId').equals(payload.operationId).first();
      if (already) {
        value = already.localSnapshot;
        return;
      }
      const chained = await entityHasUnsynced(db, entityId);
      value = await applyLocalEdit(db, type, entityId, payload, this.now());
      await db.operations.add({
        operationId: payload.operationId,
        ownerUserId: db.userId,
        entityId,
        type,
        payload,
        expectedVersion: typeof payload.expectedVersion === 'number' ? payload.expectedVersion : null,
        chained,
        createdAt: this.now().toISOString(),
        state: 'pending',
        attempts: 0,
        lastError: null,
        remote: null,
        localSnapshot: value,
        nextAttemptAt: null,
      });
    });
    this.emitData();
    await this.refreshStatus();
    this.requestBackgroundSync();
    if (this.isOnline()) this.trigger();
    return { value: value as T, persistence: 'local' };
  }

  // ---------------- SyncPort ops ----------------

  async enableOffline() {
    if (!this.isOnline()) throw new OfflineError('Conecte-se à internet para ativar o modo offline.');
    const session = await this.rawAuth.getSession();
    if (!session) throw new DataError(401, { code: 'UNAUTHENTICATED', message: 'Entre na sua conta para ativar o modo offline.', correlationId: 'local' });
    const prev = this.flags.identity;
    if (prev && prev.user.userId !== session.user.userId) await this.wipeDb(prev.user.userId);
    this.sessionUserId = session.user.userId;
    this.flags.identity = session;
    this.flags.offlineEnabled = true;
    try {
      const db = (await this.openDb())!;
      await this.bootstrap(db);
      await db.meta.put({ key: 'lastSyncedAt', value: this.now().toISOString() });
    } catch (e) {
      this.flags.offlineEnabled = false;
      await this.wipeDb(session.user.userId);
      this.flags.identity = null;
      await this.refreshStatus();
      throw e;
    }
    await this.refreshStatus();
    this.emitData();
  }

  async disableOffline() {
    const db = await this.openDb();
    if (db) {
      let pending = (await unsyncedOps(db)).length;
      if (pending && this.isOnline()) {
        await this.syncNow();
        pending = (await unsyncedOps(db)).length;
      }
      if (pending) {
        throw new DataError(409, {
          code: 'CONFIRMATION_REQUIRED',
          message: `Há ${pending} ${pending === 1 ? 'alteração salva' : 'alterações salvas'} só neste dispositivo. Sincronize ou resolva antes de desativar.`,
          correlationId: 'local',
        });
      }
      await this.wipeDb(db.userId);
    }
    this.flags.offlineEnabled = false;
    this.flags.identity = null;
    await this.refreshStatus();
    this.emitData();
  }

  async listProblemOperations(): Promise<QueuedOperationView[]> {
    const db = await this.openDb();
    if (!db) return [];
    return (await unsyncedOps(db)).map((o) => ({
      operationId: o.operationId,
      type: o.type,
      entityId: o.entityId,
      state: o.state,
      createdAt: o.createdAt,
      localPayload: o.localSnapshot ?? o.payload,
      remote: o.remote ?? undefined,
      error: o.lastError ?? undefined,
    }));
  }

  private async getOp(operationId: string) {
    const db = await this.openDb();
    if (!db) throw new OfflineError('Dados offline indisponíveis.');
    const op = await db.operations.where('operationId').equals(operationId).first();
    if (!op) throw new DataError(404, { code: 'NOT_FOUND', message: 'Operação não encontrada.', correlationId: 'local' });
    return { db, op };
  }

  /** Keep the server version: apply `remote` locally and drop the local op. Later ops of the
   * same entity were built on the dropped edit, so they also become conflicts (user decides). */
  async resolveKeepRemote(operationId: string) {
    const { db, op } = await this.getOp(operationId);
    await db.transaction('rw', dataTables(db), async () => {
      await applyRemoteSnapshot(db, op);
      await db.operations.delete(op.seq!);
      const later = (await db.operations.where('entityId').equals(op.entityId).toArray()).filter((o) => o.seq! > op.seq!);
      for (const o of later) await db.operations.update(o.seq!, { state: 'conflict', remote: op.remote, lastError: op.lastError });
    });
    this.emitData();
    await this.refreshStatus();
  }

  /** Re-queue the local edit with expectedVersion = current server version. */
  async resolveReapplyLocal(operationId: string) {
    const { db, op } = await this.getOp(operationId);
    const remote = op.remote as { version?: number } | null;
    if (op.type.endsWith('.create') || remote?.version === undefined) {
      if (op.type.endsWith('.delete') && !remote) {
        // already deleted on the server → nothing to re-apply
        await db.operations.delete(op.seq!);
      } else if (!remote) {
        throw new DataError(409, { code: 'VERSION_CONFLICT', message: 'Este registro foi excluído em outro dispositivo; não é possível reaplicar a edição.', correlationId: 'local' });
      } else {
        await db.operations.update(op.seq!, { state: 'pending', lastError: null, remote: null, chained: false });
      }
    } else {
      const payload = { ...op.payload, expectedVersion: remote.version };
      await db.operations.update(op.seq!, { payload, expectedVersion: remote.version, state: 'pending', lastError: null, chained: false });
    }
    // re-enable later ops of the entity that were held as conflicts behind this one
    const later = (await db.operations.where('entityId').equals(op.entityId).toArray()).filter((o) => o.seq! > op.seq! && o.state === 'conflict');
    for (const o of later) await db.operations.update(o.seq!, { state: 'pending', chained: true, lastError: null, remote: null });
    await this.refreshStatus();
    this.trigger();
  }

  /** Explicitly discard an op (and the later ops of the same entity built on it), then re-pull. */
  async discardOperation(operationId: string) {
    const { db, op } = await this.getOp(operationId);
    await db.transaction('rw', dataTables(db), async () => {
      const group = (await db.operations.where('entityId').equals(op.entityId).toArray()).filter((o) => o.seq! >= op.seq!);
      await db.operations.bulkDelete(group.map((o) => o.seq!));
      if (op.remote !== null && op.remote !== undefined) await applyRemoteSnapshot(db, op);
      // the server state for this entity is unknown locally → fresh snapshot on next sync
      await db.meta.put({ key: 'forceBootstrap', value: true });
    });
    if (this.isOnline()) await this.syncNow().catch(() => undefined);
    this.emitData();
    await this.refreshStatus();
  }

  async clearLocalData() {
    const owner = this.flags.identity?.user.userId;
    if (owner) await this.wipeDb(owner);
    if (this.db) await this.wipeDb(this.db.userId);
    this.flags.identity = null;
    this.setStatus({ lastSyncedAt: null, pendingCount: 0, conflictCount: 0, errorCount: 0, needsReauth: false });
    await this.refreshStatus();
    this.emitData();
  }

  // ---------------- account safety ----------------

  /** Server sign-out pending from an offline logout; must succeed before a new online session. */
  async tryRevoke(): Promise<boolean> {
    if (!this.flags.pendingRevocation) return true;
    if (!this.isOnline()) return false;
    try {
      await this.rawAuth.signOut();
    } catch (e) {
      if (e instanceof OfflineError) return false;
      // 401 etc: the session is already gone server-side
    }
    this.flags.pendingRevocation = false;
    return true;
  }

  /** Called with every authenticated session we learn about (getSession / signIn / signUp). */
  async adoptSession(session: SessionResponse) {
    this.sessionUserId = session.user.userId;
    const owner = this.flags.identity;
    if (!owner) {
      if (this.flags.offlineEnabled) this.flags.identity = session;
      this.foreign = null;
      return;
    }
    if (owner.user.userId === session.user.userId) {
      this.flags.identity = session;
      this.foreign = null;
      return;
    }
    // Different account: the previous account's local data must never be shown to this one.
    const prevDb = new ZeloDb(owner.user.userId);
    const pendingCount = (await unsyncedOps(prevDb)).length;
    prevDb.close();
    if (pendingCount === 0) {
      await this.wipeDb(owner.user.userId);
      this.flags.identity = null;
      this.flags.offlineEnabled = false; // offline is a per-person opt-in
      this.foreign = null;
    } else {
      // keep it (never discard silently) but isolate it; user must sign in as that account or discard
      this.foreign = { userId: owner.user.userId, email: owner.user.email, pendingCount };
    }
    await this.refreshStatus();
    this.emitData();
  }

  getForeignAccount() {
    return this.foreign;
  }

  async discardForeignAccountData() {
    if (!this.foreign) return;
    await this.wipeDb(this.foreign.userId);
    this.foreign = null;
    this.flags.identity = null;
    this.flags.offlineEnabled = false;
    await this.refreshStatus();
    this.emitData();
  }

  setSignOutHandler(h: SignOutHandler | null) {
    this.signOutHandler = h;
  }

  async signOut() {
    const db = await this.openDb();
    if (db) {
      let pending = (await unsyncedOps(db)).length;
      let syncFailed = false;
      while (pending > 0) {
        if (!this.signOutHandler) {
          throw new DataError(409, {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Há alterações não sincronizadas neste dispositivo. Escolha sincronizar ou descartar antes de sair.',
            correlationId: 'local',
          });
        }
        const choice = await this.signOutHandler({ pendingCount: pending, online: this.isOnline(), syncFailed });
        if (choice === 'cancel') throw new SignOutCancelledError();
        if (choice === 'discard') break;
        await this.syncNow().catch(() => undefined);
        pending = (await unsyncedOps(db)).length;
        syncFailed = pending > 0;
      }
    }

    await this.removePushSubscription();

    let revoked = false;
    if (this.isOnline()) {
      try {
        await this.rawAuth.signOut();
        revoked = true;
      } catch (e) {
        revoked = !(e instanceof OfflineError) && e instanceof DataError && e.status === 401;
      }
    }
    if (!revoked) this.flags.pendingRevocation = true;

    const owner = this.flags.identity?.user.userId;
    if (owner) await this.wipeDb(owner);
    this.flags.identity = null;
    this.flags.offlineEnabled = false;
    this.sessionUserId = null;
    this.foreign = null;
    this.setStatus({ lastSyncedAt: null, needsReauth: false });
    await this.refreshStatus();
    this.emitData();
  }

  private async removePushSubscription() {
    const id = this.flags.pushSubscriptionId;
    if (id && this.isOnline()) {
      try {
        await this.api.pushUnsubscribe(id);
      } catch {
        /* server also revokes this device's subscriptions on sign-out (x-device-id) */
      }
    }
    this.flags.pushSubscriptionId = null;
    try {
      if (this.opts.unsubscribeBrowserPush) await this.opts.unsubscribeBrowserPush();
      else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        await sub?.unsubscribe();
      }
    } catch {
      /* best effort */
    }
  }

  // ---------------- local reads ----------------

  localNow() {
    return this.now();
  }
}

// ======================================================================
// Data source
// ======================================================================

export function createOfflineDataSource(rt: OfflineRuntime): ZeloDataSource {
  const http = rt.http;
  const online = () => rt.isOnline();

  async function local<T>(fromDb: (db: ZeloDb) => Promise<T>, remote: () => Promise<T>): Promise<T> {
    const db = await rt.readyDb();
    return db ? fromDb(db) : remote();
  }

  /** online-only mutation; result mirrored into the local replica when enabled */
  async function onlineOnly<T>(call: () => Promise<T>, mirror?: (db: ZeloDb, v: T) => Promise<unknown>): Promise<T> {
    const db = await rt.readyDb();
    if (db && !online()) throw new OfflineError();
    const v = await call();
    if (db && mirror) {
      await mirror(db, v);
      rt.emitData();
    }
    return v;
  }

  async function occurrencesFor(db: ZeloDb, date: string): Promise<Occurrence[]> {
    if (online()) {
      try {
        const remote = await http.listOccurrences(date);
        const pending = new Set((await unsyncedOps(db)).map((o) => o.entityId));
        await db.transaction('rw', dataTables(db), async () => {
          for (const o of remote.items) {
            if (pending.has(o.id)) continue;
            await db.occurrences.put(o);
            if (o.intake) await db.intakeRecords.put(o.intake);
          }
          const existing = await db.occurrences.where('localDate').equals(date).toArray();
          const ids = new Set(remote.items.map((o) => o.id));
          await db.occurrences.bulkDelete(existing.filter((o) => !ids.has(o.id) && !pending.has(o.id)).map((o) => o.id));
        });
      } catch (e) {
        if (!(e instanceof OfflineError)) throw e;
      }
    }
    return withDerivedState(await db.occurrences.where('localDate').equals(date).toArray(), rt.localNow());
  }

  async function profileOf(db: ZeloDb): Promise<Profile> {
    const p = await db.profile.toCollection().first();
    if (!p) throw new OfflineError('Perfil indisponível offline.');
    return p;
  }

  const strip = (g: (WeightGoal & { key?: string }) | undefined): WeightGoal | null => {
    if (!g) return null;
    const { key: _key, ...rest } = g;
    void _key;
    return rest;
  };

  return {
    getProfile: () => local(profileOf, () => http.getProfile()),
    updateProfile: (input) => onlineOnly(() => http.updateProfile(input), (db, p) => db.profile.put(p)),
    getDashboard: (date) =>
      local(
        async (db): Promise<DashboardResponse> => {
          const profile = await profileOf(db);
          const d = date ?? localDateIn(profile.timezone, rt.localNow());
          return composeDashboard({
            date: d,
            profile,
            weights: await db.weightEntries.toArray(),
            bloodPressure: await db.bloodPressureEntries.toArray(),
            measurements: await db.measurementSessions.toArray(),
            occurrences: await occurrencesFor(db, d),
            now: rt.localNow(),
          });
        },
        () => http.getDashboard(date),
      ),

    listWeights: (q: HistoryQuery) => local(async (db) => pageLocal(withDeltas(await db.weightEntries.toArray()), q), () => http.listWeights(q)),
    createWeight: (input: CreateWeightRequest) => rt.mutate('weight.create', input.id, input, () => http.createWeight(input)),
    updateWeight: (id, input: UpdateWeightRequest) => rt.mutate('weight.update', id, input, () => http.updateWeight(id, input)),
    deleteWeight: (id, input: DeleteRequest) => rt.mutate('weight.delete', id, input, () => http.deleteWeight(id, input)),
    getWeightGoal: () => local(async (db) => strip(await db.weightGoal.get('current')), () => http.getWeightGoal()),
    putWeightGoal: (input) => onlineOnly(() => http.putWeightGoal(input), (db, g) => db.weightGoal.put({ ...g, key: 'current' })),
    deleteWeightGoal: () => onlineOnly(() => http.deleteWeightGoal(), (db) => db.weightGoal.clear()),

    listMeasurements: (q) => local(async (db) => pageLocal(await db.measurementSessions.toArray(), q), () => http.listMeasurements(q)),
    createMeasurement: (input: CreateMeasurementRequest) => rt.mutate('measurement.create', input.id, input, () => http.createMeasurement(input)),
    updateMeasurement: (id, input: UpdateMeasurementRequest) => rt.mutate('measurement.update', id, input, () => http.updateMeasurement(id, input)),
    deleteMeasurement: (id, input) => rt.mutate('measurement.delete', id, input, () => http.deleteMeasurement(id, input)),

    listBloodPressure: (q) => local(async (db) => pageLocal(await db.bloodPressureEntries.toArray(), q), () => http.listBloodPressure(q)),
    createBloodPressure: (input: CreateBloodPressureRequest) => rt.mutate('bloodPressure.create', input.id, input, () => http.createBloodPressure(input)),
    updateBloodPressure: (id, input: UpdateBloodPressureRequest) => rt.mutate('bloodPressure.update', id, input, () => http.updateBloodPressure(id, input)),
    deleteBloodPressure: (id, input) => rt.mutate('bloodPressure.delete', id, input, () => http.deleteBloodPressure(id, input)),

    listRoutineItems: (includeArchived) =>
      local(
        async (db) =>
          (await db.routineItems.toArray())
            .filter((i) => includeArchived || !i.archivedAt)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        () => http.listRoutineItems(includeArchived),
      ),
    createRoutineItem: (input) => onlineOnly(() => http.createRoutineItem(input), (db, i: RoutineItem) => db.routineItems.put(i)),
    updateRoutineItem: (id, input) => onlineOnly(() => http.updateRoutineItem(id, input), (db, i: RoutineItem) => db.routineItems.put(i)),
    reviseSchedule: (id, input) => onlineOnly(() => http.reviseSchedule(id, input), (db, i: RoutineItem) => db.routineItems.put(i)),
    archiveRoutineItem: (id, input) => onlineOnly(() => http.archiveRoutineItem(id, input), (db, i: RoutineItem) => db.routineItems.put(i)),
    listOccurrences: (date): Promise<OccurrenceList> => local(async (db) => ({ date, items: await occurrencesFor(db, date) }), () => http.listOccurrences(date)),
    putOccurrenceIntake: (occurrenceId, input: PutOccurrenceIntakeRequest) =>
      rt.mutate<IntakeRecord>('occurrence.intake.put', occurrenceId, input, () => http.putOccurrenceIntake(occurrenceId, input)),
    undoOccurrenceIntake: (occurrenceId, input) => rt.mutate('occurrence.intake.delete', occurrenceId, input, () => http.undoOccurrenceIntake(occurrenceId, input)),
    createIntake: (input: CreateIntakeRequest) => rt.mutate<IntakeRecord>('intake.create', input.id, input, () => http.createIntake(input)),
    updateIntake: (id, input) =>
      onlineOnly(
        () => http.updateIntake(id, input),
        async (db, rec: IntakeRecord) => {
          await db.intakeRecords.put(rec);
          if (rec.occurrenceId) {
            const occ = await db.occurrences.get(rec.occurrenceId);
            if (occ) await db.occurrences.put({ ...occ, intake: rec });
          }
        },
      ),
    deleteIntake: (id, input) =>
      onlineOnly(
        () => http.deleteIntake(id, input),
        async (db) => {
          const rec = await db.intakeRecords.get(id);
          await db.intakeRecords.delete(id);
          if (rec?.occurrenceId) {
            const occ = await db.occurrences.get(rec.occurrenceId);
            if (occ) await db.occurrences.put({ ...occ, intake: null });
          }
        },
      ),

    subscribe(listener) {
      const a = http.subscribe(listener);
      const b = rt.subscribeData(listener);
      return () => {
        a();
        b();
      };
    },
  };
}

// ======================================================================
// Auth wrapper
// ======================================================================

export function createOfflineAuth(rt: OfflineRuntime): AuthPort {
  const auth = rt.rawAuth;
  return {
    async getSession() {
      if (rt.flags.pendingRevocation && !(await rt.tryRevoke())) return null;
      try {
        const s = await auth.getSession();
        if (s) await rt.adoptSession(s);
        return s;
      } catch (e) {
        // offline + previously authenticated + offline enabled → open the local shell
        if (e instanceof OfflineError && rt.flags.offlineEnabled && rt.flags.identity) return rt.flags.identity;
        throw e;
      }
    },
    async signIn(input: SignInRequest) {
      if (!(await rt.tryRevoke())) throw new OfflineError();
      const s = await auth.signIn(input);
      await rt.adoptSession(s);
      rt.trigger();
      return s;
    },
    async signUp(input: SignUpRequest) {
      if (!(await rt.tryRevoke())) throw new OfflineError();
      const s = await auth.signUp(input);
      await rt.adoptSession(s);
      return s;
    },
    signOut: () => rt.signOut(),
    requestPasswordReset: (email) => auth.requestPasswordReset(email),
    confirmPasswordReset: (token, password) => auth.confirmPasswordReset(token, password),
  };
}

export function createOfflineSyncPort(rt: OfflineRuntime): OfflineSyncPort {
  return {
    isOfflineSync: true,
    getStatus: rt.getStatus,
    subscribeStatus: rt.subscribeStatus,
    syncNow: rt.syncNow,
    enableOffline: () => rt.enableOffline(),
    disableOffline: () => rt.disableOffline(),
    listProblemOperations: () => rt.listProblemOperations(),
    resolveKeepRemote: (id) => rt.resolveKeepRemote(id),
    resolveReapplyLocal: (id) => rt.resolveReapplyLocal(id),
    discardOperation: (id) => rt.discardOperation(id),
    clearLocalData: () => rt.clearLocalData(),
    setSignOutHandler: (h) => rt.setSignOutHandler(h),
    getForeignAccount: () => rt.getForeignAccount(),
    discardForeignAccountData: () => rt.discardForeignAccountData(),
    pushApi: () => rt.api,
    flags: () => rt.flags,
    dispose: () => rt.dispose(),
  };
}

export { UNSYNCED_STATES };
