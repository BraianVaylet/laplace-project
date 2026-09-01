import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Temporal } from '@js-temporal/polyfill';
import { Hono } from 'hono';
import type { Db } from 'mongodb';
import { createApp, type AppEnv } from '../src/app.js';
import { LOGIN_RATE_LIMIT, createAuth, type Auth } from '../src/auth/auth.js';
import { createLockoutGuard, createMongoLockoutStore } from '../src/auth/lockout-guard.js';
import { DEFAULT_LOCKOUT_POLICY } from '../src/auth/lockout.js';
import { requireSession, requireSuperAdmin, requireTwoFactor } from '../src/auth/session.js';
import type { EmailSender, MagicLinkEmail } from '../src/auth/ports.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F0-03. Las defensas de §9.1 sobre el flujo de autenticacion. El reloj se
 * inyecta: la escalera de bloqueo se prueba entera sin esperar una hora.
 */
let replSet: MongoMemoryReplSet;
let db: Db;

const magicLinks: MagicLinkEmail[] = [];
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: (email) => {
    magicLinks.push(email);
    return Promise.resolve();
  },
};

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

/** Reloj controlado: avanza cuando el test lo dice, no cuando pasa el tiempo. */
let now = Temporal.Instant.from('2026-09-01T10:00:00Z');
const clock = () => now;

function buildAuth(rateLimitEnabled: boolean): Auth {
  return createAuth({
    db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5175'],
    emailSender,
    rateLimitEnabled,
  });
}

function buildApp(auth: Auth, withLockout: boolean) {
  const probes = new Hono<AppEnv>()
    .get('/probe/dfsa', requireSession, requireSuperAdmin, requireTwoFactor, (c) =>
      c.json({ ok: true }),
    )
    .get('/probe/me', requireSession, (c) => c.json({ userId: c.get('userId') }));

  return createApp({
    logger,
    corsOrigins: ['http://localhost:5175'],
    auth,
    extraRoutes: probes,
    ...(withLockout
      ? {
          lockoutGuard: createLockoutGuard({
            store: createMongoLockoutStore(db),
            policy: DEFAULT_LOCKOUT_POLICY,
            now: clock,
          }),
        }
      : {}),
  });
}

const EMAIL = 'micaela@boxtoro.com';
const PASSWORD = 'unaClaveLargaYSegura123';

async function signUp(app: ReturnType<typeof buildApp>, email = EMAIL) {
  return app.request('/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, name: 'Micaela' }),
  });
}

async function signIn(app: ReturnType<typeof buildApp>, password: string, email = EMAIL) {
  return app.request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ email, password }),
  });
}

type ErrorBody = { success: false; error: { code: string; message: string; action?: string } };

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_hardening_test' });
  db = mongoose.connection.db as Db;
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  magicLinks.length = 0;
  now = Temporal.Instant.from('2026-09-01T10:00:00Z');
  const collections = await db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

describe('rate limit por IP', () => {
  it(`corta el login pasadas ${LOGIN_RATE_LIMIT.max} peticiones por minuto (§9.1)`, async () => {
    const app = buildApp(buildAuth(true), false);
    await signUp(app);

    const statuses: number[] = [];
    for (let i = 0; i < LOGIN_RATE_LIMIT.max + 2; i++) {
      statuses.push((await signIn(app, 'claveEquivocada123')).status);
    }

    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    const first = statuses.slice(0, LOGIN_RATE_LIMIT.max);
    expect(first.every((s) => s !== 429)).toBe(true);
  });

  it('el 429 sale con el envelope y el codigo LP-AUTH-429-003', async () => {
    const app = buildApp(buildAuth(true), false);
    await signUp(app);

    let last: Response | undefined;
    for (let i = 0; i < LOGIN_RATE_LIMIT.max + 2; i++) {
      last = await signIn(app, 'claveEquivocada123');
    }

    expect(last?.status).toBe(429);
    const body = (await last?.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-429-003');
    expect(body.error.action).toBeDefined();
  });

  it('no filtra si el email existe: mismo trato para una cuenta inexistente', async () => {
    const app = buildApp(buildAuth(true), false);

    let last: Response | undefined;
    for (let i = 0; i < LOGIN_RATE_LIMIT.max + 2; i++) {
      last = await signIn(app, 'loQueSea123', 'nadie@boxtoro.com');
    }

    expect(last?.status).toBe(429);
  });
});

describe('bloqueo progresivo por cuenta', () => {
  it('los primeros fallos no bloquean', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);

    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      const res = await signIn(app, 'claveEquivocada123');
      expect(res.status).toBe(401);
    }
  });

  it('pasado el umbral responde LP-AUTH-403-006 y dice hasta cuando', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);

    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      await signIn(app, 'claveEquivocada123');
    }

    const res = await signIn(app, 'claveEquivocada123');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-403-006');
    expect(body.error.action).toBeDefined();
  });

  it('bloquea incluso con la contrasena correcta: si no, el bloqueo no sirve de nada', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);

    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      await signIn(app, 'claveEquivocada123');
    }

    const res = await signIn(app, PASSWORD);
    expect(res.status).toBe(403);
  });

  it('vencido el bloqueo vuelve a dejar entrar', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);

    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      await signIn(app, 'claveEquivocada123');
    }
    expect((await signIn(app, PASSWORD)).status).toBe(403);

    now = now.add({ seconds: DEFAULT_LOCKOUT_POLICY.maxBlockSeconds + 1 });

    expect((await signIn(app, PASSWORD)).status).toBe(200);
  });

  it('un login exitoso limpia el contador', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);

    await signIn(app, 'claveEquivocada123');
    await signIn(app, 'claveEquivocada123');
    expect((await signIn(app, PASSWORD)).status).toBe(200);

    const doc = await db.collection('loginAttempt').findOne({ _id: `email:${EMAIL}` as never });
    expect(doc).toBeNull();
  });

  it('cuenta por cuenta, no globalmente: bloquear a una no bloquea a la otra', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);
    await signUp(app, 'juan@boxtoro.com');

    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      await signIn(app, 'claveEquivocada123');
    }

    expect((await signIn(app, 'claveEquivocada123')).status).toBe(403);
    expect((await signIn(app, PASSWORD, 'juan@boxtoro.com')).status).toBe(200);
  });

  it('normaliza el email: MICAELA@ y micaela@ son la misma cuenta', async () => {
    const app = buildApp(buildAuth(false), true);
    await signUp(app);

    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      await signIn(app, 'claveEquivocada123', EMAIL.toUpperCase());
    }

    expect((await signIn(app, PASSWORD)).status).toBe(403);
  });

  it('el bloqueo sobrevive a un reinicio: vive en Mongo, no en memoria', async () => {
    const auth = buildAuth(false);
    const app = buildApp(auth, true);
    await signUp(app);

    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      await signIn(app, 'claveEquivocada123');
    }

    const appNueva = buildApp(auth, true);
    expect((await signIn(appNueva, PASSWORD)).status).toBe(403);
  });
});

describe('magic link', () => {
  it('pedirlo manda un enlace de un solo uso', async () => {
    const app = buildApp(buildAuth(false), false);
    await signUp(app);

    const res = await app.request('/api/v1/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, callbackURL: '/' }),
    });

    expect(res.status).toBe(200);
    expect(magicLinks).toHaveLength(1);
    expect(magicLinks[0]?.to).toBe(EMAIL);
  });

  it('el enlace inicia sesion, y reusarlo ya no funciona', async () => {
    const app = buildApp(buildAuth(false), false);
    await signUp(app);
    await app.request('/api/v1/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, callbackURL: '/' }),
    });

    const token = magicLinks[0]?.token;
    expect(token).toBeDefined();

    // `verify` es un endpoint de navegador: responde 302 siempre, a la app o a
    // una URL de error. Lo que importa no es el status, es si crea sesion.
    const first = await app.request(`/api/v1/auth/magic-link/verify?token=${token}`);
    expect(first.headers.get('set-cookie')).toContain('session');

    const reuse = await app.request(`/api/v1/auth/magic-link/verify?token=${token}`);
    expect(reuse.headers.get('set-cookie') ?? '').not.toContain('session');
    expect(reuse.headers.get('location') ?? '').toContain('error');
  });

  it('un token inventado no crea sesion', async () => {
    const app = buildApp(buildAuth(false), false);

    const res = await app.request('/api/v1/auth/magic-link/verify?token=basura');

    expect(res.headers.get('set-cookie') ?? '').not.toContain('session');
    expect(res.headers.get('location') ?? '').toContain('error');
  });
});

describe('segundo factor', () => {
  async function signUpAndCookie(app: ReturnType<typeof buildApp>, email: string) {
    const res = await app.request('/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD, name: 'Alguien' }),
    });
    const raw = res.headers.get('set-cookie') ?? '';
    return raw
      .split(/,(?=[^;]+?=)/)
      .map((c) => c.split(';')[0]?.trim())
      .filter(Boolean)
      .join('; ');
  }

  it('un super admin sin 2FA no entra al DFSA: LP-AUTH-403-007', async () => {
    const app = buildApp(buildAuth(false), false);
    const cookie = await signUpAndCookie(app, 'sau@laplace.app');
    await db
      .collection('user')
      .updateOne({ email: 'sau@laplace.app' }, { $set: { isSuperAdmin: true } });

    const res = await app.request('/probe/dfsa', { headers: { cookie } });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-007');
  });

  it('un usuario comun no entra al DFSA, tenga o no 2FA', async () => {
    const app = buildApp(buildAuth(false), false);
    const cookie = await signUpAndCookie(app, 'comun@boxtoro.com');

    const res = await app.request('/probe/dfsa', { headers: { cookie } });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-002');
  });

  it('con 2FA configurado, el super admin entra', async () => {
    const app = buildApp(buildAuth(false), false);
    const cookie = await signUpAndCookie(app, 'sau@laplace.app');
    await db
      .collection('user')
      .updateOne(
        { email: 'sau@laplace.app' },
        { $set: { isSuperAdmin: true, twoFactorEnabled: true } },
      );

    const res = await app.request('/probe/dfsa', { headers: { cookie } });

    expect(res.status).toBe(200);
  });

  it('isSuperAdmin no se puede setear desde el registro', async () => {
    const app = buildApp(buildAuth(false), false);

    await app.request('/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'vivo@boxtoro.com',
        password: PASSWORD,
        name: 'Vivo',
        isSuperAdmin: true,
      }),
    });

    const user = await db.collection('user').findOne({ email: 'vivo@boxtoro.com' });
    expect(user?.['isSuperAdmin']).not.toBe(true);
  });
});
