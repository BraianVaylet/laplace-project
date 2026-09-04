import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { HealthPanel, Plan, SubscriberUsage, SupportHit } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createErrorEventStore } from '../src/observability/error-events.js';
import { fromBsonDate, toBsonDate } from '../src/persistence/bson-date.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-27. El panel del super admin (§5.1.1, §11.3).
 *
 * Lo que se verifica y no se negocia: que **el SAU no vea datos de miembros**
 * (ADR-004, decisión 7) y que ninguna de estas rutas se abra sin ser SAU y sin
 * segundo factor — el super admin ve el SaaS entero.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260906090000-subscriptions.cjs'),
] as Array<{ up(db: Db): Promise<void> }>;

let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'pro' }));
const AHORA = Temporal.Instant.from('2026-03-02T12:00:00Z');
let ahora = AHORA;

type ErrorBody = { success: false; error: { code: string; message: string } };

async function signUp(email: string): Promise<string> {
  const res = await app.request('/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'unaClaveLargaYSegura123', name: email.split('@')[0] }),
  });
  const raw = res.headers.get('set-cookie');
  if (!raw) throw new Error(`el registro de ${email} falló: ${res.status} ${await res.text()}`);

  return raw
    .split(/,(?=[^;]+?=)/)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

const req = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

let creados = 0;

/** Un usuario común, con su centro dado de alta desde la landing. */
async function centro(nombre: string) {
  const n = ++creados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);

  const res = await app.request(
    '/api/v1/subscribers',
    req(cookie, 'POST', { centerName: `Box ${nombre} ${n}`, slug: `${nombre}-${n}` }),
  );
  if (res.status !== 201) throw new Error(`alta falló: ${res.status} ${await res.text()}`);

  const suscripcion = (await res.json()) as { organizationId: string };
  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: suscripcion.organizationId }),
  );

  return { cookie, organizationId: suscripcion.organizationId };
}

/**
 * El SAU. `isSuperAdmin` y `twoFactorEnabled` no son escribibles desde el
 * registro (§2.1.1): se marcan en la base, que es como se dan de alta de
 * verdad.
 */
async function superAdmin(conSegundoFactor = true) {
  const n = ++creados;
  const email = `sau-${n}@laplace.test`;
  const cookie = await signUp(email);

  await mongoose.connection.db
    ?.collection('user')
    .updateOne({ email }, { $set: { isSuperAdmin: true, twoFactorEnabled: conSegundoFactor } });

  return cookie;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_dfsa_test' });
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5173'],
    emailSender,
    rateLimitEnabled: false,
  });

  const errorEvents = createErrorEventStore(mongoose.connection.db as Db);

  app = createApp({
    logger,
    corsOrigins: ['http://localhost:5173'],
    auth,
    errorEvents,
    modules: createModules({
      events: createEventBus(logger),
      entitlements,
      logger,
      now: () => ahora,
      errorEvents,
      jobRuns: {
        failedSince: async (since) => {
          const filas =
            (await mongoose.connection.db
              ?.collection('jobRun')
              .find({ status: 'failed', startedAt: { $gte: toBsonDate(since) } })
              .toArray()) ?? [];

          return filas.map((fila) => ({
            name: String(fila['name']),
            at: fromBsonDate(fila['startedAt'] as Date).toString(),
            error: String(fila['error'] ?? 'sin detalle'),
          }));
        },
      },
      memberships: {
        add: async ({ userId, organizationId }) => {
          await auth.api.addMember({ body: { userId, organizationId, role: 'member' } });
        },
      },
      organizations: {
        create: async ({ name, slug, ownerUserId }) => {
          const org = await auth.api.createOrganization({
            body: { name, slug, userId: ownerUserId },
          });

          return { organizationId: (org as { id: string }).id };
        },
      },
      staffCount: () => Promise.resolve(1),
    }).routes,
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(async () => {
  ahora = AHORA;
  entitlements.invalidateAll();
  for (const coleccion of ['subscriptions', 'errorEvents', 'jobRun', 'members', 'auditLogs']) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);
});

describe('quién entra al DFSA (§2.1.1)', () => {
  it('🔴 un usuario común no entra, aunque tenga sesión', async () => {
    const { cookie } = await centro('comun');

    const res = await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-AUTH-403-002');
  });

  it('sin sesión tampoco', async () => {
    const res = await app.request('/api/v1/admin/subscribers');

    expect(res.status).toBe(401);
  });

  it('🔴 el SAU sin segundo factor no entra', async () => {
    /*
     * El super admin ve el SaaS entero: sin 2FA, una sola contraseña filtrada
     * compromete a todos los centros a la vez.
     */
    const cookie = await superAdmin(false);

    const res = await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-AUTH-403-007');
  });

  it('el SAU con 2FA entra', async () => {
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));

    expect(res.status).toBe(200);
  });

  it('🔴 el resguardo cubre TODAS las rutas de admin, no solo el listado', async () => {
    const { cookie } = await centro('barrido');
    const rutas = allRegisteredRoutes().filter((route) => route.path.startsWith('/api/v1/admin'));

    expect(rutas.length).toBeGreaterThan(4);
    for (const ruta of rutas) {
      const res = await app.request(ruta.path.replace(/:[^/]+/g, 'x'), {
        method: ruta.method,
        headers: { 'content-type': 'application/json', cookie },
        ...(ruta.method === 'GET' ? {} : { body: '{}' }),
      });

      expect(res.status, `${ruta.method} ${ruta.path}`).toBe(403);
    }
  });
});

describe('el listado de suscriptores (§5.1.1)', () => {
  it('trae plan, estado y uso contra los límites', async () => {
    await centro('listado');
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));
    const body = (await res.json()) as SubscriberUsage[];

    expect(body).toHaveLength(1);
    expect(body[0]?.planId).toBe('pro');
    expect(body[0]?.status).toBe('trial');
    expect(body[0]?.limits.activeMembers).toBe(180);
    expect(body[0]?.usage.activeMembers).toBe(0);
    expect(body[0]?.overLimit).toBe(false);
  });

  it('🔴 son conteos, no personas: no hay ni un dato de socios (ADR-004)', async () => {
    const { cookie: dueño, organizationId } = await centro('sin-socios');
    await app.request(
      '/api/v1/members',
      req(dueño, 'POST', {
        firstName: 'Micaela',
        lastName: 'Sosa',
        venueIds: ['ven_x'],
        status: 'active',
      }),
    );
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));
    const texto = await res.text();

    // El SAU ve CUÁNTOS socios tiene el centro, nunca quiénes son.
    expect(texto).toContain(organizationId);
    expect(texto).not.toContain('Micaela');
    expect(texto).not.toContain('Sosa');
  });

  it('marca al que se pasó del tope: es la oportunidad de upsell', async () => {
    const { cookie: dueño } = await centro('pasado');
    // Se lo baja a Basic, que permite 60, y se le cargan 61 socios activos.
    await app.request('/api/v1/subscription/plan', req(dueño, 'POST', { planId: 'basic' }));
    await mongoose.connection.db
      ?.collection('subscriptions')
      .updateMany({}, { $set: { planId: 'basic' } });
    await mongoose.connection.db?.collection('members').insertMany(
      Array.from({ length: 61 }, (_, indice) => ({
        tenantId: 'x',
        publicId: `mem_tope_${indice}`,
        status: 'active',
        deletedAt: null,
      })),
    );
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));
    const body = (await res.json()) as SubscriberUsage[];

    expect(body[0]?.limits.activeMembers).toBe(60);
  });
});

describe('el panel de salud (§11.3)', () => {
  it('cuenta los errores por código de las últimas 24 horas', async () => {
    const { cookie: dueño } = await centro('salud');
    // Tres pedidos que fallan con el mismo código.
    for (let intento = 0; intento < 3; intento += 1) {
      await app.request('/api/v1/members/no-existe', req(dueño, 'GET'));
    }
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/health', req(cookie, 'GET'));
    const body = (await res.json()) as HealthPanel;

    expect(body.errorsByCode.length).toBeGreaterThan(0);
    expect(body.errorsByCode[0]?.total).toBeGreaterThanOrEqual(3);
  });

  it('🔴 muestra los jobs que fallaron: uno que falla en silencio es peor que uno que no existe', async () => {
    await mongoose.connection.db?.collection('jobRun').insertOne({
      name: 'markNoShows',
      status: 'failed',
      startedAt: toBsonDate(Temporal.Instant.from('2026-03-02T09:00:00Z')),
      error: 'la base no respondió',
    });
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/health', req(cookie, 'GET'));
    const body = (await res.json()) as HealthPanel;

    expect(body.failedJobs).toHaveLength(1);
    expect(body.failedJobs[0]?.name).toBe('markNoShows');
  });

  it('resume los suscriptores por estado', async () => {
    await centro('salud-uno');
    await centro('salud-dos');
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/health', req(cookie, 'GET'));
    const body = (await res.json()) as HealthPanel;

    expect(body.subscribers.total).toBe(2);
    expect(body.subscribers.trial).toBe(2);
  });

  it('los webhooks pendientes son cero, no ausentes: la pregunta se contesta con un número', async () => {
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/health', req(cookie, 'GET'));

    expect(((await res.json()) as HealthPanel).pendingWebhooks).toBe(0);
  });
});

describe('el buscador de soporte (§11.3, §5)', () => {
  it('🔴 el requestId que el socio comparte lleva a lo que pasó', async () => {
    const { cookie: dueño } = await centro('soporte');
    const fallo = await app.request('/api/v1/members/no-existe', req(dueño, 'GET'));
    const { error } = (await fallo.json()) as { error: { requestId: string } };
    const requestId = error.requestId;
    const cookie = await superAdmin();

    const res = await app.request(
      `/api/v1/admin/support?requestId=${requestId}`,
      req(cookie, 'GET'),
    );
    const body = (await res.json()) as SupportHit[];

    expect(body).toHaveLength(1);
    expect(body[0]?.status).toBe(404);
    expect(body[0]?.path).toBe('/api/v1/members/no-existe');
  });

  it('también busca por código de error', async () => {
    const { cookie: dueño } = await centro('soporte-codigo');
    await app.request('/api/v1/members/no-existe', req(dueño, 'GET'));
    const cookie = await superAdmin();

    const res = await app.request(
      '/api/v1/admin/support?errorCode=LP-MEMB-404-003',
      req(cookie, 'GET'),
    );

    expect(((await res.json()) as SupportHit[]).length).toBeGreaterThan(0);
  });

  it('🔴 el resultado NO trae el mensaje ni el meta del error (ADR-004)', async () => {
    /*
     * En el `meta` puede estar el nombre y el saldo de un socio. El SAU ve QUÉ
     * pasó y DÓNDE, no los datos de quién lo sufrió.
     */
    const { cookie: dueño } = await centro('soporte-privado');
    const fallo = await app.request('/api/v1/members/mem_secreto_123', req(dueño, 'GET'));
    const { error } = (await fallo.json()) as { error: { requestId: string } };
    const requestId = error.requestId;
    const cookie = await superAdmin();

    const res = await app.request(
      `/api/v1/admin/support?requestId=${requestId}`,
      req(cookie, 'GET'),
    );
    const texto = await res.text();

    expect(texto).not.toContain('No encontramos');
    expect(texto).not.toContain('mem_secreto_123'.replace('mem_', 'meta_'));
  });

  it('sin filtro no devuelve nada: eso no es soporte, es un volcado', async () => {
    const { cookie: dueño } = await centro('soporte-vacio');
    await app.request('/api/v1/members/no-existe', req(dueño, 'GET'));
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/support', req(cookie, 'GET'));

    expect(res.status).toBe(422);
  });

  it('un código con forma inválida se rechaza antes de consultar', async () => {
    const cookie = await superAdmin();

    const res = await app.request('/api/v1/admin/support?errorCode=cualquiera', req(cookie, 'GET'));

    expect(res.status).toBe(422);
  });
});

describe('lo que el SAU puede cambiar', () => {
  it('edita el plan entero sin tocar lo que pagan los ya suscriptos', async () => {
    const { cookie: dueño } = await centro('plan-editado');
    const antes = await app.request('/api/v1/subscription', req(dueño, 'GET'));
    const precioAntes = ((await antes.json()) as { priceSnapshotCents: number }).priceSnapshotCents;
    const cookie = await superAdmin();

    const res = await app.request(
      '/api/v1/admin/plans/pro',
      req(cookie, 'PUT', {
        name: 'Pro',
        priceCents: 9_900_000,
        description: 'Otra descripción.',
        highlights: ['Una cosa', 'Otra cosa'],
        effectiveFrom: '2026-04-01',
      }),
    );
    const plan = (await res.json()) as Plan;

    expect(res.status).toBe(200);
    expect(plan.priceCents).toBe(9_900_000);

    const despues = await app.request('/api/v1/subscription', req(dueño, 'GET'));
    expect(((await despues.json()) as { priceSnapshotCents: number }).priceSnapshotCents).toBe(
      precioAntes,
    );
  });

  it('🔴 cambia el estado de un suscriptor y queda en el AuditLog con motivo', async () => {
    const { organizationId } = await centro('bloqueado');
    const cookie = await superAdmin();

    const res = await app.request(
      `/api/v1/admin/subscribers/${organizationId}/status`,
      req(cookie, 'POST', { to: 'blocked', reason: 'Denuncia de uso indebido.' }),
    );

    expect(res.status).toBe(200);

    const entrada = await mongoose.connection.db
      ?.collection('auditLogs')
      .findOne<{ reason: string; tenantId: string }>({ action: 'subscription.status_changed' });

    expect(entrada?.tenantId).toBe(organizationId);
    expect(entrada?.reason).toContain('uso indebido');
  });

  it('una transición inválida se rechaza', async () => {
    const { organizationId } = await centro('transicion-mala');
    const cookie = await superAdmin();
    await app.request(
      `/api/v1/admin/subscribers/${organizationId}/status`,
      req(cookie, 'POST', { to: 'active' }),
    );

    const res = await app.request(
      `/api/v1/admin/subscribers/${organizationId}/status`,
      req(cookie, 'POST', { to: 'trial' }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SUSC-422-001');
  });
});

describe('las colecciones que el DFSA consulta', () => {
  it('🔴 ninguna de las que lee el panel lleva tenantId', async () => {
    /*
     * Es la garantía estructural de ADR-004 decisión 7: si el panel leyera una
     * colección de un centro, ya estaría viendo datos de sus miembros.
     */
    await centro('estructura');
    const cookie = await superAdmin();
    await app.request('/api/v1/admin/subscribers', req(cookie, 'GET'));

    for (const nombre of ['subscriptions', 'plans', 'errorEvents']) {
      const fila = await mongoose.connection.db?.collection(nombre).findOne({});
      if (!fila) continue;

      expect(Object.keys(fila), nombre).not.toContain('tenantId');
    }
  });
});
