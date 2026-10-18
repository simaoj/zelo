import { describe, expect, it } from 'vitest';
import type { TxContext } from '../../../shared/application/ports.js';
import type { DailySteps, StepsValues } from '../domain/activity.js';
import { ConcurrentUpsertError, type DailyStepsRepository, type WorkoutRepository } from '../application/ports/out/index.js';
import { ReceiveHealthExport } from '../application/use-cases/receive-health-export.js';

const tx = {} as TxContext;

function setup(opts: { failFirst?: boolean } = {}) {
  const store = new Map<string, DailySteps>();
  let failed = !opts.failFirst;
  const changes: string[] = [];
  const steps = {
    async upsert(userId: string, provider: 'health-auto-export', v: StepsValues, receivedAt: Date, newId: string) {
      if (!failed) {
        failed = true;
        // a racing request inserted the same day first
        store.set(v.localDate, { id: 'racer', userId, provider, ...v, receivedAt, createdAt: receivedAt });
        throw new ConcurrentUpsertError();
      }
      const before = store.get(v.localDate) ?? null;
      store.set(v.localDate, { id: before?.id ?? newId, userId, provider, ...v, receivedAt, createdAt: before?.createdAt ?? receivedAt });
      return { before, id: before?.id ?? newId };
    },
  } as unknown as DailyStepsRepository;
  let n = 0;
  const uc = new ReceiveHealthExport({
    steps,
    workouts: {} as WorkoutRepository,
    uow: { run: (work) => work(tx) },
    changeLog: { record: async (_tx, _u, c) => void changes.push(`${c.entity}:${c.id}`) },
    clock: { now: () => new Date('2026-10-18T18:00:00Z') },
    ids: { next: () => `id-${++n}` },
  });
  return { uc, store, changes };
}

describe('ReceiveHealthExport', () => {
  it('counts inserted / updated / unchanged from the stored state; change rows only for real changes', async () => {
    const { uc, changes } = setup();
    const v = { localDate: '2026-10-18', count: 6842, offsetMinutes: -180 };
    expect((await uc.execute('u1', { steps: [v], workouts: [] })).steps).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect((await uc.execute('u1', { steps: [v], workouts: [] })).steps).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect((await uc.execute('u1', { steps: [{ ...v, count: 7100 }], workouts: [] })).steps).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(changes).toEqual(['dailySteps:id-1', 'dailySteps:id-1']);
  });

  it('retries the batch once after a duplicate-key race (no error surfaces)', async () => {
    const { uc, store } = setup({ failFirst: true });
    const r = await uc.execute('u1', { steps: [{ localDate: '2026-10-18', count: 6842, offsetMinutes: -180 }], workouts: [] });
    expect(r.steps).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(store.get('2026-10-18')?.id).toBe('racer');
  });

  it('rejects invalid values even if an adapter let them through', async () => {
    const { uc } = setup();
    await expect(uc.execute('u1', { steps: [{ localDate: '2026-10-18', count: 1.5, offsetMinutes: 0 }], workouts: [] })).rejects.toThrow();
  });
});
