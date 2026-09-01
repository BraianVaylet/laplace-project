import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Hono } from 'hono';
import type { Db } from 'mongodb';
import { createApp, type AppEnv } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import { requireSession, requireVerifiedEmail } from '../src/auth/session.js';
import type { EmailSender, VerificationEmail } from '../src/auth/ports.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F0-01. Integracion real: Mongo en memoria y Better Auth de verdad. Lo unico
 * que se sustituye es el envio de mail, que se inyecta como puerto — ningun
 * test toca la red.
 */
let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof buildTestApp>;
let auth: Auth;

const sent: VerificationEmail[] = [];
const emailSender: EmailSender = {
  sendVerification: (email) => {
    sent.push(email);
    return Promise.resolve();
  },
  sendMagicLink: () => Promise.resolve(),
};

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

/**
 * La app real mas dos rutas sonda que ejercitan los guards. Las sondas viven
 * aca y no en produccion: lo que se testea son los middlewares, no las rutas.
 */
function buildTestApp(authInstance: Auth) {
  const probes = new Hono<AppEnv>()
    .get('/probe/me', requireSession, (c) => c.json({ userId: c.get('userId') }))
    .get('/probe/booking', requireSession, requireVerifiedEmail, (c) =>
      c.json({ ok: true, userId: c.get('userId') }),
    );

  return createApp({
    logger,
    corsOrigins: ['http://localhost:5175'],
    auth: authInstance,
    extraRoutes: probes,
  });
}

const EMAIL = 'micaela@boxtoro.com';
const PASSWORD = 'unaClaveLargaYSegura123';

async function signUp(email = EMAIL, password = PASSWORD) {
  return app.request('/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Micaela' }),
  });
}

async function signIn(email = EMAIL, password = PASSWORD) {
  return app.request('/api/v1/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

/** La cookie de sesion viaja en set-cookie; se replica tal cual en la proxima peticion. */
function cookieOf(res: Response): string {
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error('la respuesta no trajo cookie de sesion');
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

type ErrorBody = {
  success: false;
  error: { code: string; message: string; action?: string; requestId: string; timestamp: string };
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_auth_test' });

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5175'],
    emailSender,
  });
  app = buildTestApp(auth);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  sent.length = 0;
  const db = mongoose.connection.db;
  if (db) {
    const collections = await db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }
});

describe('registro', () => {
  it('crea el usuario, lo deja sin verificar y manda el mail de verificacion', async () => {
    const res = await signUp();

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(EMAIL);
    expect(sent[0]?.url.length).toBeGreaterThan(0);

    const user = await mongoose.connection.db?.collection('user').findOne({ email: EMAIL });
    expect(user).not.toBeNull();
    expect(user?.['emailVerified']).toBe(false);
  });

  it('un email ya registrado responde LP-AUTH-409-009 con el envelope de la spec', async () => {
    await signUp();
    const res = await signUp();

    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('LP-AUTH-409-009');
    expect(body.error.requestId.length).toBeGreaterThan(0);
    expect(body.error.timestamp.length).toBeGreaterThan(0);
  });
});

describe('login', () => {
  it('con credenciales validas devuelve cookie de sesion', async () => {
    await signUp();
    const res = await signIn();

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeTruthy();
  });

  it('con contrasena incorrecta responde LP-AUTH-401-001', async () => {
    await signUp();
    const res = await signIn(EMAIL, 'claveEquivocada123');

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-401-001');
  });

  it('no revela si el email existe: mismo codigo y mismo mensaje que una clave mala', async () => {
    await signUp();
    const wrongPassword = (await (await signIn(EMAIL, 'claveEquivocada123')).json()) as ErrorBody;
    const noSuchUser = (await (
      await signIn('nadie@boxtoro.com', 'claveEquivocada123')
    ).json()) as ErrorBody;

    expect(noSuchUser.error.code).toBe(wrongPassword.error.code);
    expect(noSuchUser.error.message).toBe(wrongPassword.error.message);
  });
});

describe('sesion', () => {
  it('una peticion autenticada expone el userId en el contexto', async () => {
    await signUp();
    const cookie = cookieOf(await signIn());

    const res = await app.request('/probe/me', { headers: { cookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId.length).toBeGreaterThan(0);
  });

  it('sin sesion responde LP-AUTH-401-005', async () => {
    const res = await app.request('/probe/me');

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-401-005');
  });

  it('con una cookie invalida tambien responde LP-AUTH-401-005', async () => {
    const res = await app.request('/probe/me', {
      headers: { cookie: 'better-auth.session_token=basura' },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-401-005');
  });

  it('la sesion sobrevive porque vive en Mongo, no en memoria del proceso', async () => {
    await signUp();
    const cookie = cookieOf(await signIn());

    // El registro ya deja sesion iniciada, asi que hay mas de una: lo que se
    // verifica es que esten persistidas, no cuantas son.
    const sessions = await mongoose.connection.db?.collection('session').countDocuments();
    expect(sessions).toBeGreaterThanOrEqual(1);

    // Una app nueva, con el mismo Mongo, reconoce la misma sesion.
    const otherApp = buildTestApp(auth);
    const res = await otherApp.request('/probe/me', { headers: { cookie } });
    expect(res.status).toBe(200);
  });
});

describe('verificacion de email', () => {
  it('un usuario sin verificar no puede reservar: LP-AUTH-403-004', async () => {
    await signUp();
    const cookie = cookieOf(await signIn());

    const res = await app.request('/probe/booking', { headers: { cookie } });

    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-403-004');
    expect(body.error.action).toBeDefined();
  });

  it('una vez verificado, la misma ruta lo deja pasar', async () => {
    await signUp();
    const verifyUrl = sent[0]?.url;
    expect(verifyUrl).toBeDefined();

    const verifyRes = await app.request(
      new URL(verifyUrl as string).pathname + new URL(verifyUrl as string).search,
    );
    expect(verifyRes.status).toBeLessThan(400);

    const cookie = cookieOf(await signIn());
    const res = await app.request('/probe/booking', { headers: { cookie } });

    expect(res.status).toBe(200);
  });

  it('no bloquea el login: verificar es requisito para reservar, no para entrar', async () => {
    await signUp();
    const res = await signIn();

    expect(res.status).toBe(200);
  });
});

describe('contrato de errores', () => {
  it('todo error de auth sale con el envelope unificado y el requestId del cliente', async () => {
    const res = await app.request('/api/v1/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-de-prueba' },
      body: JSON.stringify({ email: 'nadie@boxtoro.com', password: 'loQueSea123' }),
    });

    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.requestId).toBe('req-de-prueba');
    expect(body.error.code).toMatch(/^LP-[A-Z]{2,4}-\d{3}-\d{3}$/);
  });
});
