import { serve } from '@hono/node-server';
import mongoose from 'mongoose';
import type { Db } from 'mongodb';
import { createApp } from './app.js';
import { createAuth } from './auth/auth.js';
import { createLockoutGuard, createMongoLockoutStore } from './auth/lockout-guard.js';
import { createLoggingEmailSender } from './auth/ports.js';
import { createEntitlementsLoader } from './entitlements/middleware.js';
import { createErrorEventStore } from './observability/error-events.js';
import { fromBsonDate, toBsonDate } from './persistence/bson-date.js';
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
    // Solo dev puede apagarlo: el schema del entorno rechaza `off` en el resto.
    rateLimitEnabled: env.AUTH_RATE_LIMIT === 'on',
  });

  const events = createEventBus(logger);
  const entitlements = createEntitlementsLoader(createOrganizationPlanReader(db as Db));
  const errorEvents = createErrorEventStore(db as Db);

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
    /*
     * El alta self-service de la landing (F1-25). La organizacion la crea
     * Better Auth: el modulo de suscripciones no conoce la libreria de
     * identidad, solo pide que exista una y le cuelga su suscripcion.
     */
    organizations: {
      create: async ({ name, slug, ownerUserId }) => {
        const org = await auth.api.createOrganization({
          body: { name, slug, userId: ownerUserId },
        });

        return { organizationId: (org as { id: string }).id };
      },
    },
    errorEvents,
    /*
     * Las corridas de job que fallaron, para el panel de salud del DFSA
     * (§11.3). Se leen de la coleccion que ya escribe el runner: un job que
     * falla en silencio es peor que un job que no existe.
     */
    jobRuns: {
      failedSince: async (since) => {
        const filas = await (db as Db)
          .collection('jobRun')
          .find({ status: 'failed', startedAt: { $gte: toBsonDate(since) } })
          .sort({ startedAt: -1 })
          .limit(20)
          .toArray();

        return filas.map((fila) => ({
          name: String(fila['name']),
          at: fromBsonDate(fila['startedAt'] as Date).toString(),
          error: String(fila['error'] ?? 'sin detalle'),
        }));
      },
    },

    /*
     * El dueño de la cuenta: el `owner` de la organizacion de Better Auth. Es a
     * quien le llega el aviso de que soporte entro (§2.1.3). Se lee de la
     * coleccion y no por la API porque esto corre sin sesion del dueño.
     */
    owner: async (organizationId) => {
      const membresia = await (db as Db)
        .collection('member')
        .findOne<{ userId: string }>({ organizationId, role: 'owner' });
      if (!membresia) return null;

      const user = await (db as Db)
        .collection('user')
        .findOne<{ name?: string; email?: string }>({ id: membresia.userId });

      return {
        userId: membresia.userId,
        name: user?.name ?? 'Titular de la cuenta',
        email: user?.email ?? null,
      };
    },

    /*
     * Los usuarios de staff que ocupan cupo del plan (§2.2.1). Se cuenta sobre
     * la coleccion de Better Auth y no por su API porque esto corre sin sesion
     * — lo consulta el chequeo de limites antes de bajar de plan.
     *
     * El rol `member` no cuenta: son los socios del centro, que tienen su
     * propio limite.
     */
    staffCount: async (organizationId) =>
      (db as Db).collection('member').countDocuments({
        organizationId,
        role: { $ne: 'member' },
      }),
  });

  const app = createApp({
    logger,
    corsOrigins: env.CORS_ORIGINS,
    auth,
    errorEvents,
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
