import { serve } from '@hono/node-server';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createLockoutGuard, createMongoLockoutStore } from './auth/lockout-guard.js';
import { createLoggingEmailSender } from './auth/ports.js';
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

  const db = mongoose.connection.db;
  if (!db) throw new Error('Mongoose conecto pero no expuso la base');

  const auth = createAuth({
    db: db as Db,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.CORS_ORIGINS,
    // TODO(F1-21): reemplazar por el proveedor real cuando entre Notifications.
    emailSender: createLoggingEmailSender((msg, meta) => {
      logger.info(meta, msg);
    }),
  });

  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    auth,
    lockoutGuard: createLockoutGuard({ store: createMongoLockoutStore(db as Db) }),
  });

  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    logger.info({ module: 'boot', action: 'listen', meta: info }, `API en :${info.port}`);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ module: 'boot', action: 'startup' }, String(error));
  process.exit(1);
});
