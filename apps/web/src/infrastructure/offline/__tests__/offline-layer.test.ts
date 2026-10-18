// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeightEntry } from '@zelo/contracts';
import { OfflineError } from '@/shared/data/ports';
import { createOfflineDataLayer } from '../index';
import { OfflineRuntime, createOfflineAuth, createOfflineDataSource, createOfflineSyncPort, isSignOutCancelled } from '../layer';
import { ZeloDb, dbName } from '../db';
import { FakeServer, U1, U2, memoryStorage, uuid, weightInput } from './fakes';

const layers: Array<{ sync: { dispose(): void } }> = [];

function makeLayer(server: FakeServer, storage = memoryStorage()) {
  const layer = createOfflineDataLayer(server.http(), server.auth, {
    api: server.api,
    storage,
    isOnline: () => server.online,
    autoSync: false,
    installListeners: false,
    unsubscribeBrowserPush: async () => undefined,
  });
  layers.push(layer);
  return layer;
}

async function enabledLayer(server = new FakeServer(), storage = memoryStorage()) {
  const layer = makeLayer(server, storage);
  await layer.auth.getSession();
  await layer.sync.enableOffline();
  return { server, storage, layer };
}

const rawDb = (userId: string) => new ZeloDb(userId);

afterEach(async () => {
  for (const l of layers.splice(0)) l.sync.dispose();
  await Dexie.delete(dbName(U1));
  await Dexie.delete(dbName(U2));
});

describe('offline disabled', () => {
  it('passes through to HTTP and stores nothing locally', async () => {
    const server = new FakeServer();
    const layer = makeLayer(server);
    const res = await layer.data.createWeight(weightInput());
    expect(res.persistence).toBe('server');
    expect(server.weights.size).toBe(1);
    expect(await Dexie.exists(dbName(U1))).toBe(false);
    expect(layer.sync.getStatus().offlineEnabled).toBe(false);
  });
});

describe('queue + local write', () => {
  it('pages intake history offline by the original history instant, including decisions outside the occurrence cache', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const db = rawDb(U1);
    const base = { itemId: uuid(), occurrenceId: null, status: 'taken' as const, notes: null, nameSnapshot: 'Exemplo', doseSnapshot: '1', unitSnapshot: 'cápsula', version: 0, createdAt: '2026-10-17T12:00:00.000Z', updatedAt: '2026-10-17T12:00:00.000Z' };
    await db.intakeRecords.bulkPut([
      { ...base, id: 'a', actualTakenAt: '2026-10-10T12:00:00.000Z' },
      { ...base, id: 'b', occurrenceId: uuid(), status: 'not_taken', actualTakenAt: null, sortAt: '2026-10-09T12:00:00.000Z' },
    ]);
    db.close();
    const first = await layer.data.listIntakes({ limit: 1 });
    expect(first.items.map((i) => i.id)).toEqual(['a']);
    const second = await layer.data.listIntakes({ limit: 1, cursor: first.nextCursor! });
    expect(second.items.map((i) => i.id)).toEqual(['b']);
    expect(second.nextCursor).toBeNull();
  });

  it('offline create writes entity and queued op in one transaction and returns persistence local', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = weightInput('82.35');
    const res = await layer.data.createWeight(input);
    expect(res.persistence).toBe('local');
    expect((res.value as WeightEntry).weightKg).toBe('82.35');
    const db = rawDb(U1);
    expect(await db.weightEntries.get(input.id)).toBeTruthy();
    const ops = await db.operations.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ operationId: input.operationId, entityId: input.id, ownerUserId: U1, state: 'pending', type: 'weight.create' });
    db.close();
    expect(layer.sync.getStatus().pendingCount).toBe(1);
    // listing reads from IndexedDB while offline
    const page = await layer.data.listWeights({});
    expect(page.items.map((w) => w.id)).toEqual([input.id]);
  });

  it('rolls back the local write when queuing fails (atomic)', async () => {
    const server = new FakeServer();
    const storage = memoryStorage();
    const rt = new OfflineRuntime(server.http(), server.auth, { api: server.api, storage, isOnline: () => server.online, autoSync: false, installListeners: false });
    layers.push({ sync: { dispose: () => rt.dispose() } });
    await createOfflineAuth(rt).getSession();
    await rt.enableOffline();
    const data = createOfflineDataSource(rt);
    const db = (await rt.openDb())!;
    db.operations.hook('creating', () => {
      throw new Error('disk full');
    });
    server.online = false;
    const input = weightInput();
    await expect(data.createWeight(input)).rejects.toThrow('disk full');
    expect(await db.weightEntries.get(input.id)).toBeUndefined();
    expect(await db.operations.count()).toBe(0);
  });

  it('online-only actions throw OfflineError while offline', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await expect(layer.data.putWeightGoal({ operationId: uuid(), targetKg: '70' })).rejects.toBeInstanceOf(OfflineError);
  });

  it('validation errors are reported immediately instead of being queued', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await expect(layer.data.createWeight({ ...weightInput(), weightKg: '82.351' })).rejects.toMatchObject({ status: 422 });
    expect(layer.sync.getStatus().pendingCount).toBe(0);
  });
});

describe('sync engine', () => {
  it('offline create survives a new layer instance and syncs exactly once on reconnect', async () => {
    const storage = memoryStorage();
    const { server, layer } = await enabledLayer(new FakeServer(), storage);
    server.online = false;
    const input = weightInput('82.35');
    await layer.data.createWeight(input);
    layer.sync.dispose(); // "close the app"

    const reopened = makeLayer(server, storage);
    // offline: session comes from the device identity, data from IndexedDB
    expect((await reopened.auth.getSession())?.user.userId).toBe(U1);
    expect((await reopened.data.listWeights({})).items).toHaveLength(1);

    server.online = true;
    await reopened.sync.syncNow();
    await reopened.sync.syncNow(); // a second sync must not resend
    expect(server.operationCalls).toHaveLength(1);
    expect(server.operationCalls[0]!.map((o) => (o.payload as { operationId: string }).operationId)).toEqual([input.operationId]);
    expect(server.weights.size).toBe(1);
    expect(reopened.sync.getStatus()).toMatchObject({ pendingCount: 0, conflictCount: 0 });
    const local = (await reopened.data.listWeights({})).items[0]!;
    expect(local.version).toBe(1); // replaced by the server body
    expect(reopened.sync.getStatus().lastSyncedAt).not.toBeNull();
  });

  it('a lost response is replayed with the same operationId without duplicating', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = weightInput();
    await layer.data.createWeight(input);
    server.online = true;
    server.loseNextResponse = true;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus().pendingCount).toBe(1); // not confirmed locally
    await layer.sync.syncNow();
    expect(server.operationCalls).toHaveLength(2);
    expect(server.operationCalls.flat().every((o) => (o.payload as { operationId: string }).operationId === input.operationId)).toBe(true);
    expect(server.applied).toBe(1);
    expect(server.weights.size).toBe(1);
    expect(layer.sync.getStatus().pendingCount).toBe(0);
  });

  it('preserves create → update → delete order and rebases chained versions', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = weightInput('80');
    const created = await layer.data.createWeight(input);
    const v0 = (created.value as WeightEntry).version;
    await layer.data.updateWeight(input.id, { operationId: uuid(), expectedVersion: v0, weightKg: '81' });
    await layer.data.deleteWeight(input.id, { operationId: uuid(), expectedVersion: v0 });
    expect(layer.sync.getStatus().pendingCount).toBe(3);
    server.online = true;
    await layer.sync.syncNow();
    const types = server.operationCalls.flat().map((o) => o.type);
    expect(types).toEqual(['weight.create', 'weight.update', 'weight.delete']);
    expect((server.operationCalls[1]![0]!.payload as { expectedVersion: number }).expectedVersion).toBe(1);
    expect((server.operationCalls[2]![0]!.payload as { expectedVersion: number }).expectedVersion).toBe(2);
    expect(server.weights.size).toBe(0);
    expect(layer.sync.getStatus()).toMatchObject({ pendingCount: 0, conflictCount: 0, errorCount: 0 });
  });

  it('401 pauses the queue and asks for login', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await layer.data.createWeight(weightInput());
    server.online = true;
    server.sessionUser = null;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus()).toMatchObject({ needsReauth: true, pendingCount: 1 });
    expect(server.operationCalls).toHaveLength(0);

    // per-operation 401 also pauses
    server.sessionUser = U1;
    server.forceStatus = 401;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus()).toMatchObject({ needsReauth: true, pendingCount: 1 });
    server.forceStatus = null;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus()).toMatchObject({ needsReauth: false, pendingCount: 0 });
  });

  it('5xx is transient: stays pending and is retried', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await layer.data.createWeight(weightInput());
    server.online = true;
    server.forceStatus = 503;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus()).toMatchObject({ pendingCount: 1, errorCount: 0 });
    server.forceStatus = null;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus().pendingCount).toBe(0);
  });

  it('backoff grows exponentially with jitter and is capped', () => {
    const rt = new OfflineRuntime(new FakeServer().http(), new FakeServer().auth, { installListeners: false, storage: memoryStorage() });
    expect(rt.backoffDelayFor(1, 0.5)).toBe(2000);
    expect(rt.backoffDelayFor(3, 0.5)).toBe(8000);
    expect(rt.backoffDelayFor(30, 0.5)).toBe(300000);
    expect(rt.backoffDelayFor(1, 0)).toBe(1400);
    expect(rt.backoffDelayFor(1, 1)).toBe(2600);
    rt.dispose();
  });

  it('validation errors from the server stay visible for correction', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = weightInput();
    await layer.data.createWeight(input);
    server.online = true;
    server.forceStatus = 422;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus()).toMatchObject({ pendingCount: 0, errorCount: 1 });
    const [problem] = await layer.sync.listProblemOperations();
    expect(problem).toMatchObject({ state: 'error', operationId: input.operationId });
    expect(problem!.error).toBeTruthy();
  });

  it('remote tombstone removes the local copy', async () => {
    const server = new FakeServer();
    const w = weightInput();
    server.upsertWeight({ ...w, version: 1, createdAt: w.measuredAt, updatedAt: w.measuredAt, notes: null, deltaKg: null } as WeightEntry);
    const { layer } = await enabledLayer(server);
    expect((await layer.data.listWeights({})).items).toHaveLength(1);
    server.deleteWeight(w.id); // deleted on another device
    await layer.sync.syncNow();
    expect((await layer.data.listWeights({})).items).toHaveLength(0);
  });
});

describe('conflicts (409 VERSION_CONFLICT)', () => {
  async function conflicted() {
    const server = new FakeServer();
    const w = weightInput('80');
    server.upsertWeight({ ...w, version: 1, createdAt: w.measuredAt, updatedAt: w.measuredAt, notes: null, deltaKg: null } as WeightEntry);
    const ctx = await enabledLayer(server);
    // other device edits while this one is offline
    server.upsertWeight({ ...server.weights.get(w.id)!, weightKg: '79', version: 2 });
    server.online = false;
    const myEdit = { operationId: uuid(), expectedVersion: 1, weightKg: '81' };
    await ctx.layer.data.updateWeight(w.id, myEdit);
    server.online = true;
    await ctx.layer.sync.syncNow();
    return { ...ctx, id: w.id, myEdit };
  }

  it('never overwrites silently: conflict exposes local and remote', async () => {
    const { layer, server, id, myEdit } = await conflicted();
    expect(server.weights.get(id)!.weightKg).toBe('79');
    expect(layer.sync.getStatus().conflictCount).toBe(1);
    const [p] = await layer.sync.listProblemOperations();
    expect(p).toMatchObject({ state: 'conflict', operationId: myEdit.operationId });
    expect((p!.localPayload as WeightEntry).weightKg).toBe('81');
    expect((p!.remote as WeightEntry).weightKg).toBe('79');
  });

  it('"Manter versão do servidor" applies the remote version and drops the local op', async () => {
    const { layer, server, id, myEdit } = await conflicted();
    await layer.sync.resolveKeepRemote(myEdit.operationId);
    expect((await layer.data.listWeights({})).items[0]!.weightKg).toBe('79');
    expect(layer.sync.getStatus().conflictCount).toBe(0);
    expect(server.weights.get(id)!.weightKg).toBe('79');
  });

  it('"Reaplicar minha edição" re-queues with expectedVersion = remote version', async () => {
    const { layer, server, id, myEdit } = await conflicted();
    await layer.sync.resolveReapplyLocal(myEdit.operationId);
    await layer.sync.syncNow();
    expect(server.weights.get(id)).toMatchObject({ weightKg: '81', version: 3 });
    expect(layer.sync.getStatus()).toMatchObject({ conflictCount: 0, pendingCount: 0 });
    expect((await layer.data.listWeights({})).items[0]!.weightKg).toBe('81');
  });
});

describe('account safety', () => {
  it('signing in as a different user wipes the previous user local DB', async () => {
    const { server, layer } = await enabledLayer();
    expect(await Dexie.exists(dbName(U1))).toBe(true);
    await layer.auth.signIn({ email: '2222@example.com', password: 'x' });
    expect(await Dexie.exists(dbName(U1))).toBe(false);
    expect(layer.sync.getStatus().offlineEnabled).toBe(false);
    void server;
  });

  it('a different account never sees nor discards silently the previous account pending queue', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await layer.data.createWeight(weightInput());
    server.online = true;
    await layer.auth.signIn({ email: '2222@example.com', password: 'x' });
    expect(await Dexie.exists(dbName(U1))).toBe(true);
    expect(layer.sync.getForeignAccount()).toMatchObject({ userId: U1, pendingCount: 1 });
    // U2 reads go to the server, not to U1's local data
    expect((await layer.data.listWeights({})).items).toHaveLength(0);
    await layer.sync.syncNow();
    expect(server.operationCalls).toHaveLength(0); // never sent with U2's session
    await layer.sync.discardForeignAccountData();
    expect(await Dexie.exists(dbName(U1))).toBe(false);
  });

  it('logout with pending operations requires an explicit choice', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await layer.data.createWeight(weightInput());
    server.online = true;
    // no dialog registered → refuses
    await expect(layer.auth.signOut()).rejects.toMatchObject({ status: 409 });
    // cancel → stays signed in, data intact
    layer.sync.setSignOutHandler(async () => 'cancel');
    const cancelled = await layer.auth.signOut().catch((e) => e);
    expect(isSignOutCancelled(cancelled)).toBe(true);
    expect(server.signOutCalls).toBe(0);
    expect(await Dexie.exists(dbName(U1))).toBe(true);
    // discard → wipes and signs out
    const prompts: number[] = [];
    layer.sync.setSignOutHandler(async (p) => {
      prompts.push(p.pendingCount);
      return 'discard';
    });
    await layer.auth.signOut();
    expect(prompts).toEqual([1]);
    expect(server.signOutCalls).toBe(1);
    expect(await Dexie.exists(dbName(U1))).toBe(false);
    expect(server.weights.size).toBe(0);
  });

  it('"Sincronizar e sair" syncs before wiping', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await layer.data.createWeight(weightInput());
    server.online = true;
    layer.sync.setSignOutHandler(async () => 'sync');
    await layer.auth.signOut();
    expect(server.weights.size).toBe(1);
    expect(await Dexie.exists(dbName(U1))).toBe(false);
  });

  it('offline logout clears locally and revokes the server session on reconnect', async () => {
    const { server, layer, storage } = await enabledLayer();
    server.online = false;
    await layer.auth.signOut();
    expect(await Dexie.exists(dbName(U1))).toBe(false);
    expect(storage.map.get('zelo-pending-revocation')).toBe('1');
    expect(await layer.auth.getSession()).toBeNull(); // offline shell no longer opens the account
    server.online = true;
    expect(await layer.auth.getSession()).toBeNull(); // revocation ran first
    expect(server.signOutCalls).toBe(1);
    expect(storage.map.has('zelo-pending-revocation')).toBe(false);
    for (const v of storage.map.values()) expect(v).not.toMatch(/token/i);
  });

  it('logout removes this device push subscription', async () => {
    const { server, layer, storage } = await enabledLayer();
    storage.setItem('zelo-push-subscription-id', 'sub-1');
    await layer.auth.signOut();
    expect(server.pushDeletes).toEqual(['sub-1']);
    expect(storage.map.has('zelo-push-subscription-id')).toBe(false);
  });
});

describe('occurrence intake offline', () => {
  it('records an intake offline and syncs it; absence is never converted to not_taken', async () => {
    const server = new FakeServer();
    const occId = uuid();
    server.occurrences.set(occId, {
      id: occId,
      itemId: uuid(),
      scheduleVersionId: uuid(),
      scheduledAt: '2026-10-17T11:00:00.000Z',
      localDate: '2026-10-17',
      localTime: '08:00',
      nameSnapshot: 'Vitamina D',
      doseSnapshot: '1',
      unitSnapshot: 'cápsula',
      itemType: 'vitamin',
      state: 'scheduled',
      intake: null,
    });
    const { layer } = await enabledLayer(server);
    server.online = false;
    const before = await layer.data.listOccurrences('2026-10-17');
    expect(['scheduled', 'unrecorded']).toContain(before.items[0]!.state);
    const res = await layer.data.putOccurrenceIntake(occId, { operationId: uuid(), intakeId: uuid(), status: 'taken', actualTakenAt: '2026-10-17T11:05:00.000Z' });
    expect(res.persistence).toBe('local');
    expect((await layer.data.listOccurrences('2026-10-17')).items[0]!.state).toBe('taken');
    server.online = true;
    await layer.sync.syncNow();
    expect(server.occurrences.get(occId)!.intake?.status).toBe('taken');
    expect(layer.sync.getStatus().pendingCount).toBe(0);
  });
});

describe('schema migration', () => {
  it('upgrading from v1 keeps data and the queue', async () => {
    const v1 = new Dexie(dbName(U1));
    v1.version(1).stores({
      profile: 'userId',
      weightEntries: 'id, measuredAt',
      weightGoal: 'key',
      measurementSessions: 'id, measuredAt',
      bloodPressureEntries: 'id, measuredAt',
      routineItems: 'id',
      occurrences: 'id, localDate, itemId',
      intakeRecords: 'id, occurrenceId, itemId',
      operations: '++seq, &operationId, entityId, state',
      meta: 'key',
    });
    await v1.open();
    const w = weightInput();
    await v1.table('weightEntries').put({ ...w, version: 0, createdAt: w.measuredAt, updatedAt: w.measuredAt, notes: null, deltaKg: null });
    await v1.table('operations').add({ operationId: w.operationId, ownerUserId: U1, entityId: w.id, type: 'weight.create', payload: w, expectedVersion: null, createdAt: w.measuredAt, state: 'pending', attempts: 0, lastError: null, remote: null, localSnapshot: null });
    await v1.table('meta').put({ key: 'cursor', value: '0' });
    v1.close();

    const db = new ZeloDb(U1);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.weightEntries.count()).toBe(1);
    const [op] = await db.operations.toArray();
    expect(op).toMatchObject({ operationId: w.operationId, chained: false, nextAttemptAt: null, state: 'pending' });
    expect(await db.drafts.count()).toBe(0);
    db.close();
  });
});

describe('status listeners', () => {
  it('emits status changes', async () => {
    const { server, layer } = await enabledLayer();
    const fn = vi.fn();
    const off = layer.sync.subscribeStatus(fn);
    server.online = false;
    await layer.data.createWeight(weightInput());
    expect(fn).toHaveBeenCalled();
    expect(fn.mock.calls.at(-1)![0].pendingCount).toBe(1);
    off();
  });
});

// keep SyncPort factory referenced for API-shape regressions
void createOfflineSyncPort;
