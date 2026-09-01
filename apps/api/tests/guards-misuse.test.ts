import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Hono } from 'hono';
import type { Db } from 'mongodb';
import { createApp, type AppEnv } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import { requirePermission } from '../src/auth/organization.js';
import { requireSession } from '../src/auth/session.js';
import { createLockoutGuard, createMongoLockoutStore } from '../src/auth/lockout-guard.js';
import { createMongoJobLock } from '../src/jobs/lock.js';
import { createLogger } from '../src/observability/logger.js';
import { Temporal } from '@js-temporal/polyfill';

/**
 * Los caminos defensivos: que pasa cuando un guard se monta mal o le llega algo
 * que no esperaba. Son los que en produccion aparecen a las 3 AM, asi que
 * conviene que esten pinchados por un test y no por un incidente.
 */
let replSet: MongoMemoryReplSet;
let db: Db;
let auth: Auth;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

type ErrorBody = { success: false; error: { code: string } };

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_misuse_test' });
  db = mongoose.connection.db as Db;
  auth = createAuth({
    db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: [],
    emailSender: {
      sendVerification: () => Promise.resolve(),
      sendMagicLink: () => Promise.resolve(),
    },
    rateLimitEnabled: false,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

describe('guards montados mal', () => {
  it('requireSession sin instancia de auth responde 500, no deja pasar', async () => {
    const probes = new Hono<AppEnv>().get('/probe', requireSession, (c) => c.json({ ok: true }));
    const app = createApp({ logger, corsOrigins: [], extraRoutes: probes });

    const res = await app.request('/probe');

    expect(res.status).toBe(500);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-500-001');
  });

  it('requirePermission sin requireOrganization antes corta con LP-AUTH-403-011', async () => {
    const probes = new Hono<AppEnv>().get(
      '/probe',
      // Falta `requireOrganization` a proposito: sin contexto de centro, el
      // guard no puede evaluar nada y tiene que fallar cerrado.
      requirePermission({ businessMetrics: ['read'] }),
      (c) => c.json({ ok: true }),
    );
    const app = createApp({ logger, corsOrigins: [], auth, extraRoutes: probes });

    const res = await app.request('/probe');

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-011');
  });
});

describe('el guard de bloqueo ante entradas raras', () => {
  const guard = () => createLockoutGuard({ store: createMongoLockoutStore(db) });

  it('un body que no es JSON no lo rompe: deja seguir y que falle quien corresponde', async () => {
    const app = createApp({ logger, corsOrigins: [], auth, lockoutGuard: guard() });

    const res = await app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'esto no es json',
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(500);
  });

  it('un body sin email tampoco: no hay cuenta que bloquear', async () => {
    const app = createApp({ logger, corsOrigins: [], auth, lockoutGuard: guard() });

    const res = await app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'sinEmail123' }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.collection('loginAttempt').countDocuments()).toBe(0);
  });
});

describe('quien tiene el lock de un job', () => {
  const now = () => Temporal.Now.instant();

  it('sin lock, nadie', async () => {
    const lock = createMongoJobLock(db, 'instancia-a');

    expect(await lock.heldBy('jobSinTomar')).toBeNull();
  });

  it('tomado, dice que instancia lo tiene: es lo que muestra el panel de salud', async () => {
    const lock = createMongoJobLock(db, 'instancia-a');
    await lock.acquire('dunning', 300, now());

    expect(await lock.heldBy('dunning')).toBe('instancia-a');
  });

  it('vencido, no lo cuenta como tomado aunque el documento siga ahi', async () => {
    const lock = createMongoJobLock(db, 'instancia-a');
    await lock.acquire('markNoShows', 1, now().subtract({ seconds: 10 }));

    expect(await lock.heldBy('markNoShows')).toBeNull();
  });
});
