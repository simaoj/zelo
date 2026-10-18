// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WaterEntry, WeightEntry } from '@zelo/contracts';
import { FIELD_LABELS, OPERATION_LABELS, formatField } from '@/pwa/labels';
import { OfflineError } from '@/shared/data/ports';
import { createOfflineDataLayer } from '../index';
import { OfflineRuntime, createOfflineAuth, createOfflineDataSource, createOfflineSyncPort, isSignOutCancelled } from '../layer';
import { ZeloDb, dbName } from '../db';
import { DeviceFlags } from '../flags';
import { FakeServer, U1, U2, memoryStorage, session, steps, uuid, waterInput, weightInput, workout } from './fakes';

const layers: Array<{ sync: { dispose(): void } }> = [];

function makeLayer(server: FakeServer, storage = memoryStorage(), now?: () => Date) {
  const layer = createOfflineDataLayer(server.http(), server.auth, {
    now,
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

async function enabledLayer(server = new FakeServer(), storage = memoryStorage(), now?: () => Date) {
  const layer = makeLayer(server, storage, now);
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
    expect(db.verno).toBe(3);
    expect(await db.weightEntries.count()).toBe(1);
    const [op] = await db.operations.toArray();
    expect(op).toMatchObject({ operationId: w.operationId, chained: false, nextAttemptAt: null, state: 'pending' });
    expect(await db.drafts.count()).toBe(0);
    expect(await db.waterEntries.count()).toBe(0);
    db.close();
  });

  it('upgrading from v2 → v3 keeps data and pending ops, adds water/activity tables and refetches the snapshot', async () => {
    const v2 = new Dexie(dbName(U1));
    v2.version(1).stores({
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
    v2.version(2).stores({ operations: '++seq, &operationId, entityId, state, ownerUserId', drafts: 'key' });
    await v2.open();
    const server = new FakeServer();
    const w = weightInput('82.35');
    const local = { ...w, version: 0, createdAt: w.measuredAt, updatedAt: w.measuredAt, notes: null, deltaKg: null };
    delete (local as { operationId?: string }).operationId;
    await v2.table('profile').put(server.profile());
    await v2.table('weightEntries').put(local);
    await v2.table('operations').add({ operationId: w.operationId, ownerUserId: U1, entityId: w.id, type: 'weight.create', payload: w, expectedVersion: null, chained: false, createdAt: w.measuredAt, state: 'pending', attempts: 0, lastError: null, remote: null, localSnapshot: local, nextAttemptAt: null });
    await v2.table('meta').put({ key: 'cursor', value: '0' });
    await v2.table('drafts').put({ key: 'peso', value: { weightKg: '80' }, updatedAt: w.measuredAt });
    v2.close();

    const db = new ZeloDb(U1);
    await db.open();
    expect(db.verno).toBe(3);
    expect(await db.weightEntries.count()).toBe(1);
    expect(await db.drafts.count()).toBe(1);
    expect((await db.operations.toArray()).map((o) => [o.operationId, o.state])).toEqual([[w.operationId, 'pending']]);
    expect(await db.waterEntries.count()).toBe(0);
    expect(await db.workouts.count()).toBe(0);
    expect((await db.meta.get('forceBootstrap'))?.value).toBe(true);
    db.close();

    // the app (already opted in) syncs: new snapshot brings water, the pending op is sent once
    const existing = waterInput(250, '2026-10-17T12:00:00.000Z');
    server.upsertWater({ id: existing.id, consumedAt: existing.consumedAt, timezone: existing.timezone, amountMl: 250, notes: null, version: 1, createdAt: existing.consumedAt, updatedAt: existing.consumedAt });
    const storage = memoryStorage();
    const flags = new DeviceFlags(storage);
    flags.offlineEnabled = true;
    flags.identity = session(U1);
    const layer = makeLayer(server, storage);
    await layer.sync.syncNow();
    expect(server.operationCalls.flat().map((o) => (o.payload as { operationId: string }).operationId)).toEqual([w.operationId]);
    expect(server.weights.size).toBe(1);
    expect((await layer.data.listWaterEntries({})).items.map((e) => e.amountMl)).toEqual([250]);
    expect(layer.sync.getStatus().pendingCount).toBe(0);
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

// ======================================================================
// Água (offline through the existing queue) + atividade (read-only replica)
// ======================================================================

describe('water offline', () => {
  it('create offline → new layer instance → reconnect → exactly ONE operation with the same operationId', async () => {
    const storage = memoryStorage();
    const { server, layer } = await enabledLayer(new FakeServer(), storage);
    server.online = false;
    const input = waterInput(300);
    const res = await layer.data.createWaterEntry(input);
    expect(res.persistence).toBe('local');
    expect(res.value).toMatchObject({ id: input.id, amountMl: 300, version: 0, notes: null });
    const db = rawDb(U1);
    expect(await db.waterEntries.get(input.id)).toBeTruthy();
    expect(await db.operations.toArray()).toEqual([expect.objectContaining({ type: 'water.create', operationId: input.operationId, entityId: input.id, state: 'pending' })]);
    db.close();
    layer.sync.dispose();

    const reopened = makeLayer(server, storage);
    expect((await reopened.auth.getSession())?.user.userId).toBe(U1);
    expect((await reopened.data.listWaterEntries({})).items.map((e) => e.id)).toEqual([input.id]);
    expect(await reopened.sync.listProblemOperations()).toEqual([expect.objectContaining({ state: 'pending', type: 'water.create' })]);

    server.online = true;
    await reopened.sync.syncNow();
    await reopened.sync.syncNow();
    expect(server.operationCalls).toHaveLength(1);
    expect(server.operationCalls[0]!.map((o) => [o.type, (o.payload as { operationId: string }).operationId])).toEqual([['water.create', input.operationId]]);
    expect(server.water.size).toBe(1);
    expect((await reopened.data.listWaterEntries({})).items[0]).toMatchObject({ id: input.id, version: 1 });
    expect(reopened.sync.getStatus()).toMatchObject({ pendingCount: 0, conflictCount: 0, errorCount: 0 });
  });

  it('online with offline enabled goes straight to the server (persistence server) and mirrors locally', async () => {
    const { server, layer } = await enabledLayer();
    const input = waterInput(200);
    const res = await layer.data.createWaterEntry(input);
    expect(res.persistence).toBe('server');
    expect(server.water.size).toBe(1);
    server.online = false;
    expect((await layer.data.listWaterEntries({})).items[0]).toMatchObject({ id: input.id, version: 1 });
  });

  it('a lost response is replayed with the same operationId without duplicating', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = waterInput(500);
    await layer.data.createWaterEntry(input);
    server.online = true;
    server.loseNextResponse = true;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus().pendingCount).toBe(1);
    await layer.sync.syncNow();
    expect(server.operationCalls).toHaveLength(2);
    expect(server.operationCalls.flat().every((o) => (o.payload as { operationId: string }).operationId === input.operationId)).toBe(true);
    expect(server.applied).toBe(1);
    expect(server.water.size).toBe(1);
    expect(layer.sync.getStatus().pendingCount).toBe(0);
  });

  it('preserves create → update → delete order and rebases versions', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = waterInput(200);
    const created = await layer.data.createWaterEntry(input);
    await layer.data.updateWaterEntry(input.id, { operationId: uuid(), expectedVersion: created.value.version, amountMl: 350 });
    expect((await layer.data.listWaterEntries({})).items[0]!.amountMl).toBe(350);
    await layer.data.deleteWaterEntry(input.id, { operationId: uuid(), expectedVersion: created.value.version });
    expect((await layer.data.listWaterEntries({})).items).toHaveLength(0);
    expect(layer.sync.getStatus().pendingCount).toBe(3);
    server.online = true;
    await layer.sync.syncNow();
    expect(server.operationCalls.flat().map((o) => o.type)).toEqual(['water.create', 'water.update', 'water.delete']);
    expect((server.operationCalls[1]![0]!.payload as { expectedVersion: number }).expectedVersion).toBe(1);
    expect((server.operationCalls[2]![0]!.payload as { expectedVersion: number }).expectedVersion).toBe(2);
    expect(server.water.size).toBe(0);
    expect(layer.sync.getStatus()).toMatchObject({ pendingCount: 0, conflictCount: 0, errorCount: 0 });
  });

  it('undo of a quick-add not yet synced leaves no stray entry on the server', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = waterInput(300);
    const created = await layer.data.createWaterEntry(input);
    // "Desfazer" right after the quick add
    const undo = await layer.data.deleteWaterEntry(input.id, { operationId: uuid(), expectedVersion: created.value.version });
    expect(undo.persistence).toBe('local');
    expect((await layer.data.listWaterEntries({})).items).toHaveLength(0);
    expect((await layer.data.getHydrationSummary('2026-10-18', '2026-10-18')).days[0]!.totalMl).toBeNull();
    server.online = true;
    await layer.sync.syncNow();
    // the engine sends create then delete, in order, rebased — net effect: nothing on the server
    expect(server.operationCalls.flat().map((o) => o.type)).toEqual(['water.create', 'water.delete']);
    expect(server.water.size).toBe(0);
    expect(layer.sync.getStatus()).toMatchObject({ pendingCount: 0, errorCount: 0, conflictCount: 0 });
    // and the tombstone pulled afterwards does not resurrect anything locally
    expect((await layer.data.listWaterEntries({})).items).toHaveLength(0);
  });

  it('validation errors are reported immediately (not queued)', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await expect(layer.data.createWaterEntry({ ...waterInput(), amountMl: 0 })).rejects.toMatchObject({ status: 422 });
    await expect(layer.data.createWaterEntry({ ...waterInput(), amountMl: 12.5 })).rejects.toMatchObject({ status: 422 });
    expect(layer.sync.getStatus().pendingCount).toBe(0);
  });

  it('server errors on water stay visible in the sync center', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    const input = waterInput();
    await layer.data.createWaterEntry(input);
    server.online = true;
    server.forceStatus = 422;
    await layer.sync.syncNow();
    expect(layer.sync.getStatus()).toMatchObject({ pendingCount: 0, errorCount: 1 });
    const [p] = await layer.sync.listProblemOperations();
    expect(p).toMatchObject({ state: 'error', type: 'water.create', operationId: input.operationId });
    expect(OPERATION_LABELS[p!.type]).toBe('Novo registro de água');
  });

  describe('409 VERSION_CONFLICT on water', () => {
    async function conflicted() {
      const server = new FakeServer();
      const base = waterInput(250, '2026-10-18T12:00:00.000Z');
      server.upsertWater({ id: base.id, consumedAt: base.consumedAt, timezone: base.timezone, amountMl: 250, notes: null, version: 1, createdAt: base.consumedAt, updatedAt: base.consumedAt });
      const ctx = await enabledLayer(server);
      server.upsertWater({ ...server.water.get(base.id)!, amountMl: 500, version: 2 }); // other device
      server.online = false;
      const myEdit = { operationId: uuid(), expectedVersion: 1, amountMl: 300 };
      await ctx.layer.data.updateWaterEntry(base.id, myEdit);
      server.online = true;
      await ctx.layer.sync.syncNow();
      return { ...ctx, id: base.id, myEdit };
    }

    it('exposes local and remote with pt-BR labels; never overwrites silently', async () => {
      const { layer, server, id, myEdit } = await conflicted();
      expect(server.water.get(id)!.amountMl).toBe(500);
      expect(layer.sync.getStatus().conflictCount).toBe(1);
      const [p] = await layer.sync.listProblemOperations();
      expect(p).toMatchObject({ state: 'conflict', type: 'water.update', operationId: myEdit.operationId });
      expect((p!.localPayload as WaterEntry).amountMl).toBe(300);
      expect((p!.remote as WaterEntry).amountMl).toBe(500);
      expect(FIELD_LABELS.amountMl).toBe('Quantidade (ml)');
      expect(FIELD_LABELS.consumedAt).toBe('Horário');
      expect(formatField('amountMl', 1500)).toBe('1.500 ml');
      expect(OPERATION_LABELS['water.update']).toBe('Edição de água');
    });

    it('"Manter versão do servidor" applies the remote entry', async () => {
      const { layer, server, id, myEdit } = await conflicted();
      await layer.sync.resolveKeepRemote(myEdit.operationId);
      expect((await layer.data.listWaterEntries({})).items[0]).toMatchObject({ id, amountMl: 500 });
      expect(layer.sync.getStatus().conflictCount).toBe(0);
      expect(server.water.get(id)!.amountMl).toBe(500);
    });

    it('"Reaplicar minha edição" re-sends on top of the server version', async () => {
      const { layer, server, id, myEdit } = await conflicted();
      await layer.sync.resolveReapplyLocal(myEdit.operationId);
      await layer.sync.syncNow();
      expect(server.water.get(id)).toMatchObject({ amountMl: 300, version: 3 });
      expect(layer.sync.getStatus()).toMatchObject({ conflictCount: 0, pendingCount: 0 });
      expect((await layer.data.listWaterEntries({})).items[0]!.amountMl).toBe(300);
    });
  });

  it('remote tombstones remove the local water entry and workout; unknown entities are ignored', async () => {
    const server = new FakeServer();
    const w = waterInput(200);
    server.upsertWater({ id: w.id, consumedAt: w.consumedAt, timezone: w.timezone, amountMl: 200, notes: null, version: 1, createdAt: w.consumedAt, updatedAt: w.consumedAt });
    const run = workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18');
    server.receiveWorkout(run);
    const { layer } = await enabledLayer(server);
    expect((await layer.data.listWaterEntries({})).items).toHaveLength(1);
    expect((await layer.data.listWorkouts({})).items).toHaveLength(1);
    server.deleteWater(w.id);
    server.deleteWorkout(run.id);
    server.unknownChange();
    await layer.sync.syncNow();
    expect((await layer.data.listWaterEntries({})).items).toHaveLength(0);
    expect((await layer.data.listWorkouts({})).items).toHaveLength(0);
    server.online = false;
    await expect(layer.data.getWorkout(run.id)).rejects.toMatchObject({ status: 404 });
  });

  it('hydration summary offline groups by the profile tz (23:59 / 00:01) and distinguishes absence', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await layer.data.createWaterEntry(waterInput(200, '2026-10-18T02:59:00.000Z')); // 17/10 23:59 BRT
    await layer.data.createWaterEntry(waterInput(300, '2026-10-18T03:01:00.000Z')); // 18/10 00:01 BRT
    const s = await layer.data.getHydrationSummary('2026-10-16', '2026-10-18');
    expect(s.timezone).toBe('America/Sao_Paulo');
    expect(s.days.map((d) => d.totalMl)).toEqual([null, 200, 300]);
    expect(s.averageMlOnRecordedDays).toBe(250);
    expect(await layer.data.getHydrationGoal()).toBeNull();
  });
});

describe('hydration/activity goals and activity reads', () => {
  it('goal mutations are online only; activity never creates queued operations', async () => {
    const { server, layer } = await enabledLayer();
    server.online = false;
    await expect(layer.data.putHydrationGoal({ operationId: uuid(), dailyTargetMl: 2000 })).rejects.toBeInstanceOf(OfflineError);
    await expect(layer.data.deleteHydrationGoal()).rejects.toBeInstanceOf(OfflineError);
    await expect(layer.data.putActivityGoal({ operationId: uuid(), dailyStepsTarget: 8000 })).rejects.toBeInstanceOf(OfflineError);
    await expect(layer.data.deleteActivityGoal()).rejects.toBeInstanceOf(OfflineError);
    await layer.data.getActivityToday();
    await layer.data.getStepsSummary('2026-10-01', '2026-10-18');
    await layer.data.listWorkouts({});
    expect(layer.sync.getStatus().pendingCount).toBe(0);
    expect(server.httpCalls).toEqual([]);
  });

  it('online goal mutation is mirrored into the local replica', async () => {
    const { server, layer } = await enabledLayer();
    await layer.data.putHydrationGoal({ operationId: uuid(), dailyTargetMl: 2000 });
    server.online = false;
    expect(await layer.data.getHydrationGoal()).toMatchObject({ dailyTargetMl: 2000 });
    expect((await layer.data.getHydrationSummary('2026-10-18', '2026-10-18')).goal).toMatchObject({ dailyTargetMl: 2000 });
  });

  it('steps/workouts are served offline up to the last sync: partial today, no data vs zero, lastReceivedAt', async () => {
    const server = new FakeServer();
    server.receiveSteps(steps('2026-10-16', 0, '2026-10-17T01:00:00.000Z'));
    server.receiveSteps(steps('2026-10-18', 4200, '2026-10-18T13:00:00.000Z'));
    server.activityGoal = { dailyStepsTarget: 8000, version: 1, updatedAt: '2026-10-01T00:00:00.000Z' };
    server.receiveWorkout(workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18', 1800, '2026-10-18T13:30:00.000Z'));
    server.receiveWorkout(workout('Walking', '2026-10-17T10:00:00.000Z', '2026-10-17', 900, '2026-10-17T13:30:00.000Z'));
    const now = () => new Date('2026-10-18T15:00:00.000Z'); // 12:00 in São Paulo
    const { layer } = await enabledLayer(server, memoryStorage(), now);
    // newer data arrives on the server after the last sync…
    server.receiveSteps(steps('2026-10-17', 9999));
    server.online = false;
    const s = await layer.data.getStepsSummary('2026-10-15', '2026-10-18');
    expect(s.days.map((d) => [d.count, d.partial])).toEqual([[null, false], [0, false], [null, false], [4200, true]]);
    expect(s.averageOnDaysWithData).toBe(2100);
    expect(s.goal).toMatchObject({ dailyStepsTarget: 8000 });
    expect(s.lastReceivedAt).toBe('2026-10-18T13:30:00.000Z');
    const today = await layer.data.getActivityToday();
    expect(today).toMatchObject({ date: '2026-10-18', steps: { count: 4200, partial: true }, workoutCount: 1, workoutSeconds: 1800 });
    const dash = await layer.data.getDashboard();
    expect(dash.activity).toEqual(today);
    expect(dash.hydration).toEqual({ totalMl: null, entryCount: 0, goal: null, lastEntryAt: null });
    const page = await layer.data.listWorkouts({ name: 'Running' });
    expect(page.items).toHaveLength(1);
    expect(page.availableNames).toEqual(['Running', 'Walking']);
    expect(await layer.data.getWorkout(page.items[0]!.id)).toMatchObject({ name: 'Running' });
    // …and appears after the next sync (upsert via /sync/changes)
    server.online = true;
    await layer.sync.syncNow();
    expect((await layer.data.getStepsSummary('2026-10-17', '2026-10-17')).days[0]!.count).toBe(9999);
  });

  it('dashboard composes today\'s water in the profile tz', async () => {
    const now = () => new Date('2026-10-18T15:00:00.000Z');
    const { server, layer } = await enabledLayer(new FakeServer(), memoryStorage(), now);
    server.online = false;
    await layer.data.createWaterEntry(waterInput(200, '2026-10-18T02:59:00.000Z')); // yesterday locally
    await layer.data.createWaterEntry(waterInput(300, '2026-10-18T03:01:00.000Z'));
    await layer.data.createWaterEntry(waterInput(500, '2026-10-18T14:00:00.000Z'));
    const d = await layer.data.getDashboard();
    expect(d.hydration).toEqual({ totalMl: 800, entryCount: 2, goal: null, lastEntryAt: '2026-10-18T14:00:00.000Z' });
  });
});

describe('passthrough (offline disabled) delegates every new method to HTTP', () => {
  it('water, hydration and activity', async () => {
    const server = new FakeServer();
    server.receiveWorkout(workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18'));
    const layer = makeLayer(server);
    const input = waterInput(300);
    const created = await layer.data.createWaterEntry(input);
    expect(created.persistence).toBe('server');
    const updated = await layer.data.updateWaterEntry(input.id, { operationId: uuid(), expectedVersion: 1, amountMl: 400 });
    expect(updated).toMatchObject({ persistence: 'server', value: { amountMl: 400 } });
    expect((await layer.data.deleteWaterEntry(input.id, { operationId: uuid(), expectedVersion: 2 })).persistence).toBe('server');
    await layer.data.listWaterEntries({});
    await layer.data.getHydrationSummary('2026-10-01', '2026-10-18');
    await layer.data.getHydrationGoal();
    await layer.data.putHydrationGoal({ operationId: uuid(), dailyTargetMl: 2000 });
    await layer.data.deleteHydrationGoal();
    await layer.data.getActivityToday('2026-10-18');
    await layer.data.getStepsSummary('2026-10-01', '2026-10-18');
    await layer.data.listWorkouts({});
    await layer.data.getWorkout([...server.workouts.keys()][0]!);
    await layer.data.getActivityGoal();
    await layer.data.putActivityGoal({ operationId: uuid(), dailyStepsTarget: 8000 });
    await layer.data.deleteActivityGoal();
    expect(server.httpCalls).toEqual([
      'listWaterEntries', 'getHydrationSummary', 'getHydrationGoal', 'putHydrationGoal', 'deleteHydrationGoal',
      'getActivityToday', 'getStepsSummary', 'listWorkouts', 'getWorkout', 'getActivityGoal', 'putActivityGoal', 'deleteActivityGoal',
    ]);
    expect(server.operationCalls).toHaveLength(0);
    expect(await Dexie.exists(dbName(U1))).toBe(false);
  });
});

describe('account safety with water/activity', () => {
  it('logout wipes water and activity together with the account DB', async () => {
    const server = new FakeServer();
    server.receiveSteps(steps('2026-10-18', 1234));
    server.receiveWorkout(workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18'));
    const { layer } = await enabledLayer(server);
    server.online = false;
    await layer.data.createWaterEntry(waterInput(300));
    server.online = true;
    layer.sync.setSignOutHandler(async () => 'sync');
    await layer.auth.signOut();
    expect(server.water.size).toBe(1); // synced first
    expect(await Dexie.exists(dbName(U1))).toBe(false);
    const db = rawDb(U1); // a fresh DB has nothing of the previous session
    expect(await db.waterEntries.count()).toBe(0);
    expect(await db.dailySteps.count()).toBe(0);
    expect(await db.workouts.count()).toBe(0);
    db.close();
    await Dexie.delete(dbName(U1));
  });

  it('switching account never exposes the previous account water/activity', async () => {
    const server = new FakeServer();
    server.receiveSteps(steps('2026-10-18', 1234));
    const { layer } = await enabledLayer(server);
    await layer.data.createWaterEntry(waterInput(300));
    await layer.auth.signIn({ email: '2222@example.com', password: 'x' });
    expect(await Dexie.exists(dbName(U1))).toBe(false);
    server.httpCalls = [];
    await layer.data.getStepsSummary('2026-10-18', '2026-10-18');
    await layer.data.listWaterEntries({});
    expect(server.httpCalls).toEqual(['getStepsSummary', 'listWaterEntries']); // from the server, not U1's replica
  });

  it('clearLocalData wipes the new tables', async () => {
    const server = new FakeServer();
    server.receiveWorkout(workout('Running', '2026-10-18T10:00:00.000Z', '2026-10-18'));
    const { layer } = await enabledLayer(server);
    await layer.sync.clearLocalData();
    expect(await Dexie.exists(dbName(U1))).toBe(false);
  });
});

// keep SyncPort factory referenced for API-shape regressions
void createOfflineSyncPort;
