import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import type { Db } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { Temporal } from '@js-temporal/polyfill';
import { createEntitlementsLoader } from '../../apps/api/src/entitlements/middleware.js';
import { createOrganizationPlanReader } from '../../apps/api/src/entitlements/organization-plan-reader.js';
import { createEventBus } from '../../apps/api/src/events/bus.js';
import { createModules } from '../../apps/api/src/modules/index.js';
import { createLogger } from '../../apps/api/src/observability/logger.js';

/**
 * La API de los E2E, contra una base **efímera** (§Testing.7).
 *
 * 🔴 Nunca contra staging ni contra producción. Los tres caminos críticos
 * escriben: dan de alta centros, venden packs, cobran y toman asistencia. Un
 * E2E que corre contra datos reales es un E2E que un día borra los de alguien.
 *
 * Levanta un replica set en memoria —las transacciones de reserva y cobro no
 * existen sin él—, corre las migraciones y después arranca **el entrypoint de
 * verdad** (`apps/api/src/index.ts`). Reconstruir la app acá probaría una app
 * que no es la que se despliega.
 */
const require = createRequire(import.meta.url);

const MIGRACIONES = [
  '20260901120000-mandatory-indexes',
  '20260902100000-invite-code-global-unique',
  '20260902150000-session-materialization-unique',
  '20260902160000-venue-closures',
  '20260902170000-booking-unique',
  '20260903120000-check-in-tokens',
  '20260904090000-waivers-unique',
  '20260905090000-notifications',
  '20260906090000-subscriptions',
];

const PUERTOS_WEB = ['5173', '5174', '5175', '5176'];

/**
 * El disparador de jobs, en su propio puerto y **solo acá**.
 *
 * §10 corre los jobs por cron: el de no-show, cada hora. Un E2E no puede
 * esperar a que sea la hora, y agregarle a la API una ruta para correr jobs
 * sería abrir en producción una puerta que solo necesita el test. Vive en
 * `e2e/`, se levanta con este arnés y no existe en ningún deployable.
 */
const PUERTO_JOBS = 3099;

async function main() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();

  await mongoose.connect(uri, { dbName: 'laplace_e2e' });
  const db = mongoose.connection.db as Db;
  for (const nombre of MIGRACIONES) {
    const migracion = require(`../../migrations/${nombre}.cjs`) as { up(db: Db): Promise<void> };
    await migracion.up(db);
  }
  await mongoose.disconnect();

  process.env['MONGODB_URI'] = uri;
  process.env['MONGODB_DB_NAME'] = 'laplace_e2e';
  process.env['APP_ENV'] = 'dev';
  process.env['NODE_ENV'] = 'development';
  process.env['LOG_LEVEL'] = 'error';
  process.env['API_PORT'] = '3000';
  process.env['BETTER_AUTH_SECRET'] = 'un-secreto-de-e2e-de-al-menos-32-caracteres';
  process.env['BETTER_AUTH_URL'] = 'http://localhost:3000';
  process.env['CORS_ORIGINS'] = PUERTOS_WEB.map((p) => `http://localhost:${p}`).join(',');
  /*
   * Los jobs los dispara cada test cuando los necesita (el de no-show, por
   * ejemplo). Dejarlos corriendo solos haría que el resultado dependa de en qué
   * minuto arrancó la corrida.
   */
  process.env['JOBS_ENABLED'] = 'false';

  // El entrypoint lee el entorno al importarse: por eso va después de setearlo.
  await import('../../apps/api/src/index.js');

  await levantarDisparadorDeJobs();

  const apagar = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void apagar());
  process.on('SIGTERM', () => void apagar());
}

void main();

/**
 * `POST /jobs/<nombre>[?now=<instante>]` corre ese job una vez contra la misma
 * base efímera.
 *
 * 🔴 El `now` es el **mismo seam de reloj** que usan los tests de integración
 * (`createModules({ now })`), no un atajo que falsifica datos: el job corre con
 * su lógica entera, solo que sabiendo qué hora es. Sin esto, probar que el
 * no-show se marca cuando cierra la ventana de check-in exigiría que el E2E se
 * quede una hora esperando.
 */
async function levantarDisparadorDeJobs(): Promise<void> {
  await mongoose.connect(process.env['MONGODB_URI'] as string, { dbName: 'laplace_e2e' });
  const db = mongoose.connection.db as Db;
  const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

  const jobsCon = (now: () => Temporal.Instant) =>
    createModules({
      events: createEventBus(logger),
      entitlements: createEntitlementsLoader(createOrganizationPlanReader(db)),
      logger,
      now,
      memberships: { add: () => Promise.resolve() },
    }).jobs;

  createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PUERTO_JOBS}`);
    const nombre = url.pathname.replace('/jobs/', '');
    const desde = url.searchParams.get('now');
    const reloj = desde ? () => Temporal.Instant.from(desde) : () => Temporal.Now.instant();

    const job = jobsCon(reloj).find((candidato) => candidato.name === nombre);
    if (req.method !== 'POST' || !job) {
      res.writeHead(404).end(`no existe el job ${nombre}`);

      return;
    }

    job
      .handler()
      .then(() => res.writeHead(200).end('ok'))
      .catch((error: unknown) => res.writeHead(500).end(String(error)));
  }).listen(PUERTO_JOBS);
}
