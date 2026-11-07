import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb, initDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { logger } from './lib/logger.js';
import { scheduleExpiryJob, stopExpiryJob } from './services/expiry.js';

async function main() {
  const database = await initDb();
  await migrate(database);
  await seed(database);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`DMS API listening on http://localhost:${env.PORT} (storage: ${env.STORAGE_DRIVER}, db: ${database.driver})`);
  });

  if (env.RUN_JOBS) scheduleExpiryJob(env.EXPIRY_JOB_INTERVAL_MINUTES);

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    stopExpiryJob();
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
