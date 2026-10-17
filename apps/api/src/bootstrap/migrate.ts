import { loadConfig } from './config.js';
import { createContainer } from './container.js';

/**
 * Idempotent index creation / migrations (spec §7). Safe to run on every deploy:
 * createIndex is a no-op when an identical index already exists.
 */
async function main() {
  const config = loadConfig();
  const container = await createContainer(config);
  try {
    await container.ensureIndexes();
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
