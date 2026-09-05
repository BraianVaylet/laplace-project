import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ObjectId, type Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { Plan, PlanChangeResult, Subscription } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-25. El alta del suscriptor y el ciclo de vida de su plan (§2.1.3, §2.1.4).
 *
 * Lo que se verifica y no se negocia: que el trial **no pida tarjeta**, que
 * vencerse **no borre nada**, y que cambiar el precio de un plan no cambie lo
 * que paga quien ya estaba (grandfathering).
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260906090000-subscriptions.cjs'),
] as Array<{ up(db: Db): Promise<void> }>;

let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;
let modules: ReturnType<typeof createModules>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'pro' }));

/** 09:00 del 2 de marzo en Buenos Aires. */
const AHORA = Temporal.Instant.from('2026-03-02T12:00:00Z');
let ahora = AHORA;

/** Lo que el centro tiene hoy. Lo inyecta el test para probar los límites. */
let usoActual = { venues: 1, activeMembers: 10, staffUsers: 2 };

/** Cuando tiene valor, el alta devuelve siempre esta organización. Ver abajo. */
let organizacionRepetida: string | null = null;

type ErrorBody = { success: false; error: { code: string; message: string; action?: string } };

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

/**
 * El camino de la landing: alguien se registra y da de alta su centro. Sin
 * tarjeta, en dos pedidos.
 */
async function altaDeCentro(nombre: string, overrides: Record<string, unknown> = {}) {
  const n = ++creados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);

  const res = await app.request(
    '/api/v1/subscribers',
    req(cookie, 'POST', { centerName: `Box ${nombre} ${n}`, slug: `${nombre}-${n}`, ...overrides }),
  );
  if (res.status !== 201) throw new Error(`alta falló: ${res.status} ${await res.text()}`);

  const suscripcion = (await res.json()) as Subscription;

  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: suscripcion.organizationId }),
  );

  return { cookie, suscripcion };
}

/**
 * El SAU. Las rutas de `/api/v1/admin` exigen super admin y segundo factor
 * (F1-27): `isSuperAdmin` no es escribible desde el registro, se marca en la
 * base como se da de alta de verdad.
 */
async function superAdmin() {
  const n = ++creados;
  const email = `sau-susc-${n}@laplace.test`;
  const cookie = await signUp(email);

  await mongoose.connection.db
    ?.collection('user')
    .updateOne({ email }, { $set: { isSuperAdmin: true, twoFactorEnabled: true } });

  return cookie;
}

const correrJob = async (name: string) => {
  const job = modules.jobs.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`no existe el job ${name}`);

  await job.handler();
};

const enBase = async (organizationId: string) =>
  mongoose.connection.db
    ?.collection('subscriptions')
    .findOne<{ status: string; planId: string; priceSnapshotCents: number; trialEndsAt: Date }>({
      organizationId,
    });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_susc_test' });
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5174'],
    emailSender,
    rateLimitEnabled: false,
  });

  modules = createModules({
    events: createEventBus(logger),
    entitlements,
    logger,
    now: () => ahora,
    memberships: {
      add: async ({ userId, organizationId }) => {
        await auth.api.addMember({ body: { userId, organizationId, role: 'member' } });
      },
    },
    organizations: {
      create: async ({ name, slug, ownerUserId }) => {
        /*
         * Costura del test: para probar que dos suscripciones de una misma
         * organización no existen hace falta que la creación devuelva un id ya
         * usado, y por HTTP eso no se puede provocar.
         */
        if (organizacionRepetida) return { organizationId: organizacionRepetida };

        const org = await auth.api.createOrganization({
          body: { name, slug, userId: ownerUserId },
        });

        return { organizationId: (org as { id: string }).id };
      },
    },
    // El uso lo inyecta el test: probar los límites no debería exigir dar de
    // alta 120 socios de verdad.
    staffCount: () => Promise.resolve(usoActual.staffUsers),
  });

  app = createApp({
    logger,
    corsOrigins: ['http://localhost:5174'],
    auth,
    modules: modules.routes,
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(async () => {
  ahora = AHORA;
  usoActual = { venues: 1, activeMembers: 10, staffUsers: 2 };
  organizacionRepetida = null;
  entitlements.invalidateAll();
  for (const coleccion of ['subscriptions', 'members', 'venues', 'auditLogs']) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
  // El catálogo se vuelve a sembrar: algunos tests le cambian el precio.
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);
  await mongoose.connection.db?.collection('plans').updateMany({}, [
    {
      $set: {
        priceCents: {
          $switch: {
            branches: [
              { case: { $eq: ['$planId', 'basic'] }, then: 2_500_000 },
              { case: { $eq: ['$planId', 'pro'] }, then: 4_500_000 },
            ],
            default: 7_500_000,
          },
        },
      },
    },
  ]);
});

describe('el catálogo de planes', () => {
  it('es público: la landing lo muestra sin sesión', async () => {
    const res = await app.request('/api/v1/plans');
    const body = (await res.json()) as Plan[];

    expect(res.status).toBe(200);
    expect(body.map((plan) => plan.planId)).toEqual(['basic', 'pro', 'max']);
    expect(body[0]?.highlights.length).toBeGreaterThan(0);
  });
});

describe('el alta self-service (§2.1.3, ADR-004)', () => {
  it('🔴 crea la cuenta en trial, a 14 días, sin pedir tarjeta', async () => {
    const { suscripcion } = await altaDeCentro('alta');

    expect(suscripcion.status).toBe('trial');
    expect(suscripcion.planId).toBe('pro');
    // 14 días desde la medianoche del 2 de marzo en Buenos Aires.
    expect(suscripcion.trialEndsAt).toBe('2026-03-16T03:00:00Z');
    expect(JSON.stringify(suscripcion)).not.toContain('card');
  });

  it('congela el precio del plan desde el minuto cero', async () => {
    const { suscripcion } = await altaDeCentro('congelado');

    expect(suscripcion.priceSnapshotCents).toBe(4_500_000);
  });

  it('el centro queda operativo: la organización existe y es suya', async () => {
    const { cookie, suscripcion } = await altaDeCentro('operativo');

    const res = await app.request('/api/v1/subscription', req(cookie, 'GET'));
    const mia = (await res.json()) as Subscription;

    expect(res.status).toBe(200);
    expect(mia.organizationId).toBe(suscripcion.organizationId);
  });

  it('sin sesión no se da de alta: hay que saber de quién es la cuenta', async () => {
    const res = await app.request('/api/v1/subscribers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ centerName: 'Box Anónimo' }),
    });

    expect(res.status).toBe(401);
  });
});

describe('🔴 dos centros con el mismo nombre', () => {
  it('el segundo también se puede registrar', async () => {
    /*
     * Hay más de un "Box Toro" en el país. El slug sale del nombre, y el
     * primero que llega no puede quedarse con él: el segundo vería fallar su
     * alta por un detalle de la URL que no eligió ni entiende.
     */
    const primero = await signUp(`tocayo-a-${++creados}@laplace.test`);
    const segundo = await signUp(`tocayo-b-${++creados}@laplace.test`);
    const cuerpo = { centerName: 'Box Tocayo' };

    const uno = await app.request('/api/v1/subscribers', req(primero, 'POST', cuerpo));
    const dos = await app.request('/api/v1/subscribers', req(segundo, 'POST', cuerpo));

    expect(uno.status).toBe(201);
    expect(dos.status).toBe(201);
    expect(((await dos.json()) as Subscription).centerName).toBe('Box Tocayo');
  });

  it('🔴 el slug elegido a mano sí choca: es información que pidió', async () => {
    // Quien lo eligió necesita enterarse de que está tomado, no recibir otro.
    const primero = await signUp(`slug-a-${++creados}@laplace.test`);
    const segundo = await signUp(`slug-b-${++creados}@laplace.test`);
    const cuerpo = { centerName: 'Box Elegido', slug: `elegido-${Date.now()}` };

    const uno = await app.request('/api/v1/subscribers', req(primero, 'POST', cuerpo));
    const dos = await app.request('/api/v1/subscribers', req(segundo, 'POST', cuerpo));

    expect(uno.status).toBe(201);
    expect(dos.status).toBeGreaterThanOrEqual(400);
  });
});

describe('el trial que se vence (§2.1.3)', () => {
  it('🔴 suspende la cuenta y NO borra nada', async () => {
    const { cookie, suscripcion } = await altaDeCentro('vence');
    // Un socio cargado durante el trial.
    await app.request(
      '/api/v1/members',
      req(cookie, 'POST', {
        firstName: 'Micaela',
        lastName: 'Sosa',
        venueIds: ['ven_x'],
      }),
    );
    const sociosAntes = await mongoose.connection.db?.collection('members').countDocuments({});

    ahora = Temporal.Instant.from('2026-03-17T12:00:00Z');
    await correrJob('expireTrials');

    expect((await enBase(suscripcion.organizationId))?.status).toBe('suspended');
    /*
     * §2.1.3: nunca se borra por falta de pago. Los socios y la agenda del
     * centro siguen exactamente donde estaban.
     */
    expect(await mongoose.connection.db?.collection('members').countDocuments({})).toBe(
      sociosAntes,
    );
  });

  it('el trial vigente no se toca', async () => {
    const { suscripcion } = await altaDeCentro('vigente');

    ahora = Temporal.Instant.from('2026-03-10T12:00:00Z');
    await correrJob('expireTrials');

    expect((await enBase(suscripcion.organizationId))?.status).toBe('trial');
  });

  it('correrlo dos veces no rompe: el suspendido ya no aparece', async () => {
    const { suscripcion } = await altaDeCentro('doble-corrida');

    ahora = Temporal.Instant.from('2026-03-17T12:00:00Z');
    await correrJob('expireTrials');
    await correrJob('expireTrials');

    expect((await enBase(suscripcion.organizationId))?.status).toBe('suspended');
  });

  it('la suspensión queda en el audit log, con motivo', async () => {
    const { suscripcion } = await altaDeCentro('auditado');

    ahora = Temporal.Instant.from('2026-03-17T12:00:00Z');
    await correrJob('expireTrials');

    const entrada = await mongoose.connection.db
      ?.collection('auditLogs')
      .findOne<{ reason: string; tenantId: string }>({ action: 'subscription.status_changed' });

    expect(entrada?.tenantId).toBe(suscripcion.organizationId);
    expect(entrada?.reason).toContain('trial');
  });
});

describe('el grandfathering (§2.1.4)', () => {
  it('🔴 cambiar el precio del plan no cambia lo que paga quien ya estaba', async () => {
    const { cookie, suscripcion } = await altaDeCentro('grandfathering');
    expect(suscripcion.priceSnapshotCents).toBe(4_500_000);

    // El SAU sube Pro un 50%.
    const res = await app.request(
      '/api/v1/admin/plans/pro/price',
      req(await superAdmin(), 'PUT', { priceCents: 6_750_000, effectiveFrom: '2026-04-01' }),
    );
    expect(res.status).toBe(200);

    const mia = await app.request('/api/v1/subscription', req(cookie, 'GET'));
    const actual = (await mia.json()) as Subscription;

    // El que ya estaba sigue pagando lo suyo.
    expect(actual.priceSnapshotCents).toBe(4_500_000);
  });

  it('quien se da de alta después paga el precio nuevo', async () => {
    await altaDeCentro('precio-viejo');
    await app.request(
      '/api/v1/admin/plans/pro/price',
      req(await superAdmin(), 'PUT', { priceCents: 6_750_000, effectiveFrom: '2026-04-01' }),
    );

    const { suscripcion } = await altaDeCentro('precio-nuevo');

    expect(suscripcion.priceSnapshotCents).toBe(6_750_000);
  });
});

describe('el cambio de plan (§2.1.4)', () => {
  const cambiar = async (cookie: string, planId: string) => {
    const res = await app.request('/api/v1/subscription/plan', req(cookie, 'POST', { planId }));

    return { res, body: (await res.json()) as PlanChangeResult };
  };

  it('🔴 subir es inmediato y cobra la diferencia por lo que queda', async () => {
    const { cookie, suscripcion } = await altaDeCentro('upgrade');

    // El ciclo arranca el 2 y termina el 1 de abril: 30 días.
    ahora = Temporal.Instant.from('2026-03-22T12:00:00Z');
    const { res, body } = await cambiar(cookie, 'max');

    expect(res.status).toBe(200);
    expect(body.kind).toBe('upgrade');
    expect(body.subscription.planId).toBe('max');
    // $30.000 de diferencia por los 10 días que quedan: $10.000.
    expect(body.proratedCents).toBe(1_000_000);
    expect((await enBase(suscripcion.organizationId))?.planId).toBe('max');
  });

  it('🔴 bajar queda para el fin del ciclo: el mes pagado se usa entero', async () => {
    const { cookie, suscripcion } = await altaDeCentro('downgrade');

    const { body } = await cambiar(cookie, 'basic');

    expect(body.kind).toBe('downgrade');
    expect(body.proratedCents).toBe(0);
    // Todavía es Pro: baja cuando el ciclo termina.
    expect(body.subscription.planId).toBe('pro');
    expect(body.subscription.pendingPlanId).toBe('basic');
    expect((await enBase(suscripcion.organizationId))?.planId).toBe('pro');
  });

  it('🔴 no deja bajar si no entra, y dice exactamente qué excede', async () => {
    const { cookie } = await altaDeCentro('no-entra');
    // Cuatro usuarios de staff: Basic permite tres.
    usoActual = { venues: 1, activeMembers: 10, staffUsers: 4 };

    const { res, body } = await cambiar(cookie, 'basic');
    const error = body as unknown as ErrorBody;

    expect(res.status).toBe(422);
    expect(error.error.code).toBe('LP-SUBS-422-001');
    expect(error.error.message).toContain('staff');
  });

  it('el job aplica el downgrade cuando el ciclo termina', async () => {
    const { cookie, suscripcion } = await altaDeCentro('downgrade-aplicado');
    await cambiar(cookie, 'basic');

    ahora = Temporal.Instant.from('2026-04-02T12:00:00Z');
    await correrJob('applyPendingPlanChanges');

    const fila = await enBase(suscripcion.organizationId);
    expect(fila?.planId).toBe('basic');
    expect(fila?.priceSnapshotCents).toBe(2_500_000);
  });

  it('cambiar al mismo plan no cobra ni rompe', async () => {
    const { cookie } = await altaDeCentro('mismo-plan');

    const { body } = await cambiar(cookie, 'pro');

    expect(body.kind).toBe('same');
    expect(body.proratedCents).toBe(0);
  });

  it('🔴 el cambio de plan cambia los entitlements de verdad', async () => {
    const { cookie, suscripcion } = await altaDeCentro('entitlements');

    ahora = Temporal.Instant.from('2026-03-22T12:00:00Z');
    await cambiar(cookie, 'max');

    /*
     * Si los entitlements leyeran otra cosa, cambiar de plan quedaría escrito
     * en un lado y los permisos en otro.
     */
    const fila = await enBase(suscripcion.organizationId);
    expect(fila?.planId).toBe('max');
  });
});

describe('los datos fiscales (§2.1.3)', () => {
  it('guarda CUIT, razón social y condición de IVA', async () => {
    const { cookie } = await altaDeCentro('fiscal');

    const res = await app.request(
      '/api/v1/subscription/fiscal',
      req(cookie, 'PUT', {
        cuit: '20123456786',
        businessName: 'Box Toro SRL',
        ivaCondition: 'responsable_inscripto',
      }),
    );
    const body = (await res.json()) as Subscription;

    expect(res.status).toBe(200);
    expect(body.fiscal?.businessName).toBe('Box Toro SRL');
  });

  it('🔴 un CUIT con un dígito cambiado se rechaza', async () => {
    const { cookie } = await altaDeCentro('cuit-malo');

    const res = await app.request(
      '/api/v1/subscription/fiscal',
      req(cookie, 'PUT', {
        cuit: '20123456787',
        businessName: 'Box Toro SRL',
        ivaCondition: 'monotributo',
      }),
    );
    const body = (await res.json()) as ErrorBody;

    // Un CUIT mal tipeado no se nota hasta que hay que emitir el comprobante.
    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SUSC-422-001');
  });
});

describe('la impersonación del SAU (§2.1.3, ADR-004)', () => {
  it('🔴 sin motivo no se entra', async () => {
    const { suscripcion } = await altaDeCentro('impersonacion-sin-motivo');

    const res = await app.request(
      '/api/v1/admin/impersonate',
      req(await superAdmin(), 'POST', {
        organizationId: suscripcion.organizationId,
        reason: 'ver',
      }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-SUSC-403-003');
  });

  it('🔴 con motivo entra, dura poco y queda en el audit log del centro', async () => {
    const { suscripcion } = await altaDeCentro('impersonacion');

    const res = await app.request(
      '/api/v1/admin/impersonate',
      req(await superAdmin(), 'POST', {
        organizationId: suscripcion.organizationId,
        reason: 'El SMU reportó que no le salen los cobros del martes.',
      }),
    );
    const body = (await res.json()) as { expiresAt: string; reason: string };

    expect(res.status).toBe(200);
    // Media hora: es soporte, no una sesión paralela.
    expect(body.expiresAt).toBe('2026-03-02T12:30:00Z');

    const entrada = await mongoose.connection.db
      ?.collection('auditLogs')
      .findOne<{ reason: string; tenantId: string }>({ action: 'organization.impersonated' });

    expect(entrada?.tenantId).toBe(suscripcion.organizationId);
    expect(entrada?.reason).toContain('cobros del martes');
  });

  it('el centro que no existe no se puede impersonar', async () => {
    await altaDeCentro('impersonacion-fantasma');

    const res = await app.request(
      '/api/v1/admin/impersonate',
      req(await superAdmin(), 'POST', {
        organizationId: 'org_no_existe',
        reason: 'Probando si el aislamiento aguanta un id inventado.',
      }),
    );

    expect(res.status).toBe(404);
  });
});

describe('los estados (§14)', () => {
  it('cancelar la cuenta es una transición, no un borrado', async () => {
    const { cookie, suscripcion } = await altaDeCentro('cancelar');

    const res = await app.request(
      '/api/v1/subscription/status',
      req(cookie, 'POST', { to: 'cancelled', reason: 'Cerramos el box.' }),
    );

    expect(res.status).toBe(200);
    expect((await enBase(suscripcion.organizationId))?.status).toBe('cancelled');
  });

  it('🔴 no se vuelve al trial: se prueba una vez', async () => {
    const { cookie } = await altaDeCentro('sin-retrial');
    await app.request('/api/v1/subscription/status', req(cookie, 'POST', { to: 'active' }));

    const res = await app.request(
      '/api/v1/subscription/status',
      req(cookie, 'POST', { to: 'trial' }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SUSC-422-001');
  });
});

describe('aislamiento de tenant', () => {
  it('🔴 la suscripción sale de la sesión: no hay parámetro que apuntar a otra', async () => {
    const victima = await altaDeCentro('susc-victima');
    const atacante = await altaDeCentro('susc-atacante');

    const res = await app.request('/api/v1/subscription', req(atacante.cookie, 'GET'));
    const body = (await res.json()) as Subscription;

    expect(body.organizationId).toBe(atacante.suscripcion.organizationId);
    expect(body.organizationId).not.toBe(victima.suscripcion.organizationId);
  });

  it('cambiar de plan cambia el propio, no el del otro', async () => {
    const victima = await altaDeCentro('plan-victima');
    const atacante = await altaDeCentro('plan-atacante');

    ahora = Temporal.Instant.from('2026-03-22T12:00:00Z');
    await app.request('/api/v1/subscription/plan', req(atacante.cookie, 'POST', { planId: 'max' }));

    expect((await enBase(victima.suscripcion.organizationId))?.planId).toBe('pro');
  });
});

describe('los bordes del alta', () => {
  it('sin slug, lo deriva del nombre del centro', async () => {
    const n = ++creados;
    const cookie = await signUp(`sin-slug-${n}@laplace.test`);

    const res = await app.request(
      '/api/v1/subscribers',
      // "Box Toro Bahía" tiene que poder ir en una URL.
      req(cookie, 'POST', { centerName: `Box Toro Bahía ${n}` }),
    );

    expect(res.status).toBe(201);
    const { organizationId } = (await res.json()) as Subscription;
    const org = await mongoose.connection.db
      ?.collection('organization')
      // Better Auth guarda la organización con un `ObjectId` y devuelve su texto.
      .findOne<{ slug: string }>({ _id: new ObjectId(organizationId) as never });

    expect(org?.slug).toBe(`box-toro-bahia-${n}`);
  });

  it('🔴 una organización no termina con dos suscripciones', async () => {
    const primero = await altaDeCentro('duplicado');
    organizacionRepetida = primero.suscripcion.organizationId;

    const n = ++creados;
    const cookie = await signUp(`duplicado-otra-${n}@laplace.test`);
    const res = await app.request(
      '/api/v1/subscribers',
      req(cookie, 'POST', { centerName: `Box Duplicado ${n}` }),
    );
    const body = (await res.json()) as ErrorBody;

    // Dos suscripciones serían dos planes, dos precios y ninguna forma de
    // saber cuál vale.
    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-SUSC-409-002');
  });

  it('un plan que no está en el catálogo no se puede contratar', async () => {
    await mongoose.connection.db?.collection('plans').deleteOne({ planId: 'max' });
    const n = ++creados;
    const cookie = await signUp(`sin-plan-${n}@laplace.test`);

    const res = await app.request(
      '/api/v1/subscribers',
      req(cookie, 'POST', { centerName: `Box Sin Plan ${n}`, planId: 'max' }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SUBS-422-001');
  });
});

describe('los bordes del ciclo', () => {
  it('salir del trial lo cierra: deja de tener fecha de vencimiento', async () => {
    const { cookie, suscripcion } = await altaDeCentro('cierra-trial');

    await app.request('/api/v1/subscription/status', req(cookie, 'POST', { to: 'active' }));

    expect((await enBase(suscripcion.organizationId))?.trialEndsAt).toBeNull();
  });

  it('el downgrade agendado a un plan que ya no existe no rompe el job', async () => {
    const { cookie, suscripcion } = await altaDeCentro('downgrade-sin-plan');
    await app.request('/api/v1/subscription/plan', req(cookie, 'POST', { planId: 'basic' }));
    await mongoose.connection.db?.collection('plans').deleteOne({ planId: 'basic' });

    ahora = Temporal.Instant.from('2026-04-02T12:00:00Z');
    await correrJob('applyPendingPlanChanges');

    // Sigue en Pro: no se le baja a un plan que no se puede cobrar.
    expect((await enBase(suscripcion.organizationId))?.planId).toBe('pro');
  });

  it('subir sin ciclo abierto no rompe el prorrateo', async () => {
    const { cookie, suscripcion } = await altaDeCentro('sin-ciclo');
    await mongoose.connection.db
      ?.collection('subscriptions')
      .updateOne(
        { organizationId: suscripcion.organizationId },
        { $set: { currentPeriodEndsAt: null } },
      );

    const res = await app.request(
      '/api/v1/subscription/plan',
      req(cookie, 'POST', { planId: 'max' }),
    );
    const body = (await res.json()) as PlanChangeResult;

    expect(res.status).toBe(200);
    expect(body.subscription.planId).toBe('max');
  });

  it('bajar cuando el ciclo ya venció aplica en ese momento', async () => {
    const { cookie, suscripcion } = await altaDeCentro('downgrade-sin-fecha');
    await mongoose.connection.db
      ?.collection('subscriptions')
      .updateOne(
        { organizationId: suscripcion.organizationId },
        { $set: { currentPeriodEndsAt: null } },
      );

    const res = await app.request(
      '/api/v1/subscription/plan',
      req(cookie, 'POST', { planId: 'basic' }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as PlanChangeResult).kind).toBe('downgrade');
  });
});

describe('el plan que leen los entitlements', () => {
  it('🔴 sale de la suscripción de una organización REAL de Better Auth', async () => {
    /*
     * El lector se probaba solo contra un doble de la base, y el doble tenía
     * la forma equivocada: Better Auth guarda la organización con `_id` y sin
     * campo `id`. Consultar por `id` no encontraba nunca la fila y **cada
     * centro caía al plan del trial en silencio** — un cliente de Max operando
     * como Basic. Este test pega contra la colección de verdad.
     */
    const { cookie, suscripcion } = await altaDeCentro('lector-real');
    ahora = Temporal.Instant.from('2026-03-22T12:00:00Z');
    await app.request('/api/v1/subscription/plan', req(cookie, 'POST', { planId: 'max' }));

    const { createOrganizationPlanReader } =
      await import('../src/entitlements/organization-plan-reader.js');
    const leer = createOrganizationPlanReader(mongoose.connection.db as Db);

    expect(await leer(suscripcion.organizationId)).toEqual({ planId: 'max' });
  });

  it('una organización sin suscripción ni metadata cae al plan más restrictivo', async () => {
    const { suscripcion } = await altaDeCentro('lector-sin-plan');
    await mongoose.connection.db
      ?.collection('subscriptions')
      .deleteOne({ organizationId: suscripcion.organizationId });

    const { createOrganizationPlanReader } =
      await import('../src/entitlements/organization-plan-reader.js');
    const leer = createOrganizationPlanReader(mongoose.connection.db as Db);

    expect(await leer(suscripcion.organizationId)).toEqual({ planId: 'basic' });
  });
});
