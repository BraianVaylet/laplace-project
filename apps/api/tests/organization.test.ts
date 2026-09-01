import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Hono } from 'hono';
import type { Db } from 'mongodb';
import { createApp, type AppEnv } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import { requireOrganization, requirePermission } from '../src/auth/organization.js';
import { requireSession } from '../src/auth/session.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F0-02. Un usuario pertenece a una o varias organizaciones con un rol, y los
 * permisos que valen son los del centro ACTIVO. La matriz en si se testea celda
 * por celda en `src/auth/permissions.test.ts`; aca se verifica que el guard la
 * aplique de verdad sobre una peticion HTTP.
 */
let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof buildTestApp>;
let auth: Auth;

const emailSender: EmailSender = { sendVerification: () => Promise.resolve() };
const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

function buildTestApp(authInstance: Auth) {
  const probes = new Hono<AppEnv>()
    .get('/probe/org', requireSession, requireOrganization, (c) => c.json(c.get('org')))
    .get(
      '/probe/metrics',
      requireSession,
      requireOrganization,
      requirePermission({ businessMetrics: ['read'] }),
      (c) => c.json({ ok: true }),
    )
    .post(
      '/probe/athletes',
      requireSession,
      requireOrganization,
      requirePermission({ athlete: ['create'] }),
      (c) => c.json({ ok: true }),
    )
    .post(
      '/probe/staff-invite',
      requireSession,
      requireOrganization,
      requirePermission({ invitation: ['create'] }),
      (c) => c.json({ ok: true }),
    );

  return createApp({
    logger,
    corsOrigins: ['http://localhost:5174'],
    auth: authInstance,
    extraRoutes: probes,
  });
}

async function signUpAndIn(email: string) {
  const res = await app.request('/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'unaClaveLargaYSegura123', name: email.split('@')[0] }),
  });
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error(`el registro de ${email} no devolvio cookie`);
  return raw
    .split(/,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function createOrganization(cookie: string, name: string, slug: string) {
  const res = await app.request('/api/v1/auth/organization/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, slug }),
  });
  if (res.status !== 200) throw new Error(`create org fallo: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string };
}

async function setActive(cookie: string, organizationId: string) {
  return app.request('/api/v1/auth/organization/set-active', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ organizationId }),
  });
}

/** Agrega un usuario ya registrado a una organizacion con el rol indicado. */
async function addMember(userId: string, organizationId: string, role: string) {
  await auth.api.addMember({ body: { userId, organizationId, role: role as 'member' } });
}

type ErrorBody = { success: false; error: { code: string; message: string } };

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_org_test' });

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5174'],
    emailSender,
  });
  app = buildTestApp(auth);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  const db = mongoose.connection.db;
  if (db) {
    const collections = await db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }
});

describe('organizacion activa', () => {
  it('quien crea el centro queda como owner', async () => {
    const cookie = await signUpAndIn('braian@boxtoro.com');
    const org = await createOrganization(cookie, 'Box Toro', 'box-toro');

    const res = await app.request('/probe/org', { headers: { cookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizationId: string; roles: string[] };
    expect(body.organizationId).toBe(org.id);
    expect(body.roles).toEqual(['owner']);
  });

  it('una sesion sin organizacion activa responde LP-AUTH-403-011', async () => {
    const cookie = await signUpAndIn('sinCentro@boxtoro.com');

    const res = await app.request('/probe/org', { headers: { cookie } });

    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-AUTH-403-011');
  });

  it('un mismo email es owner en un centro y coach en otro, con los permisos de cada uno', async () => {
    // Lucia arma su propio centro: ahi es owner.
    const lucia = await signUpAndIn('lucia@gymblack.com');
    const gymBlack = await createOrganization(lucia, 'Gym Black', 'gym-black');

    // Y ademas da clases en Box Toro, donde es coach.
    const braian = await signUpAndIn('braian@boxtoro.com');
    const boxToro = await createOrganization(braian, 'Box Toro', 'box-toro');
    const luciaUser = await mongoose.connection.db
      ?.collection('user')
      .findOne({ email: 'lucia@gymblack.com' });
    await addMember(String(luciaUser?._id), boxToro.id, 'coach');

    // En Gym Black ve las metricas de su negocio.
    await setActive(lucia, gymBlack.id);
    const asOwner = await app.request('/probe/metrics', { headers: { cookie: lucia } });
    expect(asOwner.status).toBe(200);

    // En Box Toro, como coach, no.
    await setActive(lucia, boxToro.id);
    const asCoach = await app.request('/probe/metrics', { headers: { cookie: lucia } });
    expect(asCoach.status).toBe(403);
    expect(((await asCoach.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-002');
  });
});

describe('permisos sobre una peticion real', () => {
  let braian: string;
  let boxToro: string;

  beforeEach(async () => {
    braian = await signUpAndIn('braian@boxtoro.com');
    boxToro = (await createOrganization(braian, 'Box Toro', 'box-toro')).id;
  });

  async function joinAs(email: string, role: string) {
    const cookie = await signUpAndIn(email);
    const user = await mongoose.connection.db?.collection('user').findOne({ email });
    await addMember(String(user?._id), boxToro, role);
    await setActive(cookie, boxToro);
    return cookie;
  }

  it('el coach no accede a las metricas de negocio (§2.1.12)', async () => {
    const cookie = await joinAs('coach@boxtoro.com', 'coach');

    const res = await app.request('/probe/metrics', { headers: { cookie } });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-002');
  });

  it('el front_desk da de alta un socio pero no invita usuarios staff', async () => {
    const cookie = await joinAs('mostrador@boxtoro.com', 'front_desk');

    const alta = await app.request('/probe/athletes', { method: 'POST', headers: { cookie } });
    expect(alta.status).toBe(200);

    const invite = await app.request('/probe/staff-invite', {
      method: 'POST',
      headers: { cookie },
    });
    expect(invite.status).toBe(403);
  });

  it('el coach no da de alta socios', async () => {
    const cookie = await joinAs('coach@boxtoro.com', 'coach');

    const res = await app.request('/probe/athletes', { method: 'POST', headers: { cookie } });

    expect(res.status).toBe(403);
  });

  it('el owner accede a todo', async () => {
    await setActive(braian, boxToro);

    expect((await app.request('/probe/metrics', { headers: { cookie: braian } })).status).toBe(200);
    expect(
      (await app.request('/probe/athletes', { method: 'POST', headers: { cookie: braian } }))
        .status,
    ).toBe(200);
    expect(
      (await app.request('/probe/staff-invite', { method: 'POST', headers: { cookie: braian } }))
        .status,
    ).toBe(200);
  });

  it('el permiso se resuelve en el servidor: mandar un rol por header no cambia nada', async () => {
    const cookie = await joinAs('coach@boxtoro.com', 'coach');

    const res = await app.request('/probe/metrics', {
      headers: { cookie, 'x-role': 'owner', 'x-permissions': 'businessMetrics:read' },
    });

    expect(res.status).toBe(403);
  });

  it('sin sesion, el guard de permisos ni siquiera llega a evaluarse', async () => {
    const res = await app.request('/probe/metrics');

    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-AUTH-401-005');
  });
});
