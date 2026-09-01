import { serve } from '@hono/node-server';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createLogger } from './observability/logger.js';

const env = loadEnv();
const logger = createLogger({
  env: env.APP_ENV,
  level: env.LOG_LEVEL,
  service: 'api',
  pretty: env.NODE_ENV === 'development',
});

async function main() {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
  logger.info({ module: 'boot', action: 'mongoConnected' }, 'Conectado a MongoDB');

  const app = createApp({ logger, corsOrigins: env.CORS_ORIGINS });

  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    logger.info({ module: 'boot', action: 'listen', meta: info }, `API en :${info.port}`);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ module: 'boot', action: 'startup' }, String(error));
  process.exit(1);
});
