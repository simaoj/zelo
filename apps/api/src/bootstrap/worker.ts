import pino from 'pino';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

/** Background worker: starts every module's jobs (e.g. notifications scheduler). */
async function main() {
  const config = loadConfig();
  const log = pino({ level: config.logLevel === 'silent' ? 'silent' : config.logLevel, name: 'zelo-worker' });
  const container = await createContainer(config);
  const stops: (() => Promise<void>)[] = [];
  for (const m of container.modules) {
    for (const job of m.jobs ?? []) {
      stops.push(await job.start());
      log.info({ module: m.name, job: job.name }, 'job started');
    }
  }
  if (!stops.length) log.warn('no jobs registered; worker idle');

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'worker shutting down');
    const timer = setTimeout(() => process.exit(1), 20_000);
    timer.unref();
    for (const stop of stops) await stop().catch((err) => log.error({ err }, 'job stop failed'));
    await container.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // keep the process alive even when there are no timers
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('fatal: worker failed', err instanceof Error ? err.message : err);
  process.exit(1);
});
