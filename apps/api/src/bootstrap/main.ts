import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

async function main() {
  const config = loadConfig();
  const container = await createContainer(config);
  await container.ensureIndexes();
  const app = await buildApp(container);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => process.exit(1), 15_000);
    timer.unref();
    try {
      await app.close();
      await container.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error('fatal: failed to start API', err instanceof Error ? err.message : err);
  process.exit(1);
});
