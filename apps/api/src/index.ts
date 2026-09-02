import { serve } from '@hono/node-server';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createLockoutGuard, createMongoLockoutStore } from './auth/lockout-guard.js';
import { createLoggingEmailSender } from './auth/ports.js';
import { createEntitlementsLoader } from './entitlements/middleware.js';
import { createOrganizationPlanReader } from './entitlements/organization-plan-reader.js';
import { createEventBus } from './events/bus.js';
import { createJobRunner } from './jobs/runner.js';
import { createModules } from './modules/index.js';
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

  const events = createEventBus(logger);
  const entitlements = createEntitlementsLoader(createOrganizationPlanReader(db as Db));

  const modules = createModules({
    events,
    entitlements,
    logger,
    /*
     * El canje de un codigo suma al usuario a la organizacion del centro con rol
     * `member`. El rol viaja acotado a proposito: el codigo da acceso de socio,
     * nunca de staff.
     */
    memberships: {
      add: async ({ userId, organizationId }) => {
        await auth.api.addMember({ body: { userId, organizationId, role: 'member' } });
      },
    },
  });

  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    auth,
    modules: modules.routes,
    lockoutGuard: createLockoutGuard({ store: createMongoLockoutStore(db as Db) }),
    openapi: {
      version: '1.0.0',
      requireAuth: env.APP_ENV === 'prod',
      serverUrl: env.BETTER_AUTH_URL,
    },
  });

  // Los jobs de §10 los declara cada modulo; el runner solo los programa.
  const jobs = createJobRunner({ db: db as Db, logger, enabled: env.JOBS_ENABLED });
  for (const job of modules.jobs) jobs.register(job);
  jobs.start();

  serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    logger.info({ module: 'boot', action: 'listen', meta: info }, `API en :${info.port}`);
  });
}

main().catch((error: unknown) => {
  logger.fatal({ module: 'boot', action: 'startup' }, String(error));
  process.exit(1);
});
