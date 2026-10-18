import type { Db } from 'mongodb';
import type { ModuleDefinition } from './module-contract.js';

export const MIGRATIONS = 'migrations';

interface MigrationDoc {
  _id: string;
  description: string;
  appliedAt: Date;
  summary: string;
}

/**
 * Runs every module migration whose id has no marker in `migrations` yet, then records the marker.
 * Migrations themselves are written to be re-runnable, so a crash between the work and the marker
 * only means the (harmless) work is repeated on the next run.
 */
export async function runMigrations(db: Db, modules: ModuleDefinition[], log: (msg: string) => void = () => {}): Promise<string[]> {
  const col = db.collection<MigrationDoc>(MIGRATIONS);
  const applied: string[] = [];
  for (const m of modules.flatMap((mod) => mod.migrations ?? [])) {
    if (await col.findOne({ _id: m.id })) continue;
    const summary = await m.run();
    await col.updateOne({ _id: m.id }, { $setOnInsert: { description: m.description, appliedAt: new Date(), summary } }, { upsert: true });
    log(`migration ${m.id}: ${summary}`);
    applied.push(m.id);
  }
  return applied;
}
