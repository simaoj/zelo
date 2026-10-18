import { loadConfig } from './config.js';
import { createContainer } from './container.js';

/**
 * Idempotent index creation + one-off data migrations (spec §7). Safe to run on every deploy:
 * createIndex is a no-op when an identical index already exists, and each data migration runs once
 * (marker in the `migrations` collection).
 */
async function main() {
  const config = loadConfig();
  const container = await createContainer(config);
  try {
    await container.ensureIndexes();
    const applied = await container.runMigrations((msg) => console.log(`migrate: ${msg}`));
    if (!applied.length) console.log('migrate: no pending data migrations');
    const cols = await container.db.listCollections({}, { nameOnly: true }).toArray();
    console.log(`migrate: indexes ensured on ${cols.length} collections of "${container.db.databaseName}"`);
  } finally {
    await container.close();
  }
}

main().catch((err) => {
  console.error('migrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
