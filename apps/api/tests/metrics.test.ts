import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { MetricsRange } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { VICTIM_INCOME_CENTS } from '../src/modules/metrics/infrastructure/routes.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-23. Los KPIs precalculados de §2.1.12.
 *
 * Cada número se verifica contra un resultado calculado a mano: un panel que
 * muestra algo que nadie puede reproducir con una calculadora no sirve para
 * decidir nada. Y se verifica que el panel **lee y no agrega**: si empezara a
 * calcular en vivo, el precálculo dejaría de tener sentido.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902150000-session-materialization-unique.cjs'),
  require('../../../migrations/20260902160000-venue-closures.cjs'),
  require('../../../migrations/20260902170000-booking-unique.cjs'),
  require('../../../migrations/20260905090000-notifications.cjs'),
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

/**
 * El reloj vive el 2 de marzo, que es el día que se mide: las clases de ese día
 * todavía no pasaron y se pueden reservar. Correr el job adelanta al 3, que es
 * cuando el job existe — mide el día de ayer.
 */
const DIA_MEDIDO = '2026-03-02';
const MEDIODIA = Temporal.Instant.from('2026-03-02T12:00:00Z');
const DIA_SIGUIENTE = Temporal.Instant.from('2026-03-03T12:00:00Z');
let ahora = MEDIODIA;

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

let creados = 0;
async function nuevoCentro(nombre: string) {
  const n = ++creados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);

  const res = await app.request('/api/v1/auth/organization/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: `Centro ${nombre} ${n}`, slug: `${nombre}-${n}` }),
  });
  if (res.status !== 200) throw new Error(`create org falló: ${res.status} ${await res.text()}`);

  const org = (await res.json()) as { id: string };
  await app.request('/api/v1/auth/organization/set-active', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ organizationId: org.id }),
  });

  return { cookie, organizationId: org.id };
}

const req = (
  cookie: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
) => ({
  method,
  headers: { 'content-type': 'application/json', cookie, ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function post<T>(cookie: string, path: string, body: unknown, headers = {}): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body, headers));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

/** Un centro con sede y sala, listo para que le carguen clases. */
async function centroListo(nombre: string) {
  const centro = await nuevoCentro(nombre);
  const sede = await post<{ publicId: string }>(centro.cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  const salas = await app.request(
    `/api/v1/rooms?venueId=${sede.publicId}`,
    req(centro.cookie, 'GET'),
  );
  const roomId = ((await salas.json()) as { items: Array<{ publicId: string }> }).items[0]
    ?.publicId as string;

  return { ...centro, venueId: sede.publicId, roomId };
}

type Centro = Awaited<ReturnType<typeof centroListo>>;

/** Una clase del 2 de marzo, el día que miden casi todos los tests. */
async function clase(centro: Centro, overrides: Record<string, unknown> = {}) {
  return post<{ publicId: string }>(centro.cookie, '/api/v1/sessions', {
    venueId: centro.venueId,
    roomId: centro.roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    // 22:00 UTC del 2 = 19:00 del 2 en Buenos Aires.
    startAt: '2026-03-02T22:00:00Z',
    durationMin: 60,
    capacity: 10,
    ...overrides,
  });
}

async function socioCon(centro: Centro, nombre: string) {
  const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    firstName: nombre,
    lastName: 'Prueba',
    venueIds: [centro.venueId],
    // El KPI cuenta los `active`: un `lead` todavía no es socio (§2.1.7).
    status: 'active',
  });

  const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
    name: 'Pack 8 clases',
    type: 'class_pack',
    priceCents: 6_000_000,
    credits: 8,
    durationDays: 60,
    venueIds: [centro.venueId],
  });
  const contrato = await post<{ publicId: string }>(centro.cookie, '/api/v1/contracts', {
    memberId: socio.publicId,
    productId: producto.publicId,
    venueId: centro.venueId,
  });
  await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/activate`, {});

  return socio.publicId;
}

let clave = 0;
async function reservar(centro: Centro, sessionId: string, memberId: string) {
  const res = await app.request(
    '/api/v1/bookings',
    req(
      centro.cookie,
      'POST',
      { sessionId, memberId },
      { 'Idempotency-Key': `mtr-${++clave}-${Date.now()}` },
    ),
  );
  if (res.status !== 201) throw new Error(`reserva falló: ${res.status} ${await res.text()}`);

  const { booking } = (await res.json()) as { booking: { publicId: string } };

  return booking.publicId;
}

const correrJob = async (name: string) => {
  const job = modules.jobs.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`no existe el job ${name}`);

  await job.handler();
};

/** El job de métricas corre al día siguiente: mide el día que ya cerró. */
async function correrMetricas() {
  ahora = DIA_SIGUIENTE;
  await correrJob('computeMetricsDaily');
}

/** El panel, tal como lo pide el DFSM. */
async function panel(centro: Centro, rango: Record<string, string> = {}) {
  const query = new URLSearchParams({ venueId: centro.venueId, ...rango });
  const res = await app.request(`/api/v1/metrics?${query.toString()}`, req(centro.cookie, 'GET'));

  return { res, body: (await res.json()) as MetricsRange };
}

/** Los KPIs de un día, leídos directo de la base. */
const filaDe = async (venueId: string, date: string) =>
  mongoose.connection.db
    ?.collection('metricsDaily')
    .findOne<Record<string, number>>({ venueId, date });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_metrics_test' });
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
  ahora = MEDIODIA;
  entitlements.invalidateAll();
  for (const coleccion of [
    'metricsDaily',
    'bookings',
    'classSessions',
    'contracts',
    'products',
    'members',
    'charges',
    'payments',
    'rooms',
    'venues',
  ]) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('el job precalcula el día (§2.1.12)', () => {
  it('🔴 cuenta asistencias, faltas, utilización y no-show con números que dan a mano', async () => {
    const centro = await centroListo('kpis');
    const sesion = await clase(centro);
    const uno = await socioCon(centro, 'Uno');
    const dos = await socioCon(centro, 'Dos');
    const tres = await socioCon(centro, 'Tres');
    const bookingUno = await reservar(centro, sesion.publicId, uno);
    await reservar(centro, sesion.publicId, dos);
    await reservar(centro, sesion.publicId, tres);

    // Uno entra, y a los otros dos el job de faltas los marca ausentes.
    ahora = Temporal.Instant.from('2026-03-02T22:10:00Z');
    await post(
      centro.cookie,
      `/api/v1/bookings/${bookingUno}/check-in`,
      {},
      { 'Idempotency-Key': `checkin-${Date.now()}` },
    );
    ahora = Temporal.Instant.from('2026-03-03T00:00:00Z');
    await correrJob('markNoShows');

    await correrMetricas();

    const fila = await filaDe(centro.venueId, DIA_MEDIDO);
    expect(fila?.attendances).toBe(1);
    expect(fila?.noShows).toBe(2);
    expect(fila?.bookings).toBe(3);
    expect(fila?.capacity).toBe(10);
    expect(fila?.sessions).toBe(1);
    // 3 reservas sobre 10 lugares; 2 faltas sobre 3 reservas.
    expect(fila?.utilization).toBe(0.3);
    expect(fila?.noShowRate).toBe(0.6667);
  });

  it('cuenta los socios activos de la sede', async () => {
    const centro = await centroListo('activos');
    await socioCon(centro, 'Uno');
    await socioCon(centro, 'Dos');

    await correrMetricas();

    expect((await filaDe(centro.venueId, DIA_MEDIDO))?.activeMembers).toBe(2);
  });

  it('🔴 el día sin actividad se guarda en cero, no se saltea', async () => {
    // Un hueco en la serie no se distingue de un día sin calcular, y el gráfico
    // dibujaría una línea que miente.
    const centro = await centroListo('dia-vacio');

    await correrMetricas();

    const fila = await filaDe(centro.venueId, DIA_MEDIDO);
    expect(fila).not.toBeNull();
    expect(fila?.sessions).toBe(0);
    expect(fila?.utilization).toBe(0);
  });

  it('la clase cancelada no cuenta como cupo: nadie hizo nada mal', async () => {
    const centro = await centroListo('cancelada');
    const sesion = await clase(centro);
    await post(centro.cookie, `/api/v1/sessions/${sesion.publicId}/cancel`, { reason: 'lluvia' });

    await correrMetricas();

    const fila = await filaDe(centro.venueId, DIA_MEDIDO);
    expect(fila?.capacity).toBe(0);
    expect(fila?.sessions).toBe(0);
  });

  it('🔴 correrlo dos veces sobre el mismo día sobreescribe, no duplica', async () => {
    const centro = await centroListo('idempotente');
    await clase(centro);

    await correrMetricas();
    await correrMetricas();

    const filas = await mongoose.connection.db
      ?.collection('metricsDaily')
      .countDocuments({ venueId: centro.venueId, date: DIA_MEDIDO });
    expect(filas).toBe(1);
  });

  it('calcula el día de ayer del centro, no el de hoy a medias', async () => {
    const centro = await centroListo('ayer');

    await correrMetricas();

    // El "hoy" del reloj es el 3 en Buenos Aires: se calcula el 2.
    expect(await filaDe(centro.venueId, DIA_MEDIDO)).not.toBeNull();
    expect(await filaDe(centro.venueId, '2026-03-03')).toBeNull();
  });
});

describe('la plata del día', () => {
  it('🔴 el ingreso sale del arqueo y la deuda vencida es una foto al cierre', async () => {
    const centro = await centroListo('plata');
    const socio = await socioCon(centro, 'Micaela');

    // Un cargo que vence el 2 y un pago parcial del mismo día.
    ahora = Temporal.Instant.from('2026-03-02T15:00:00Z');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: socio,
      venueId: centro.venueId,
      amountCents: 1_800_000,
      dueAt: '2026-03-02T12:00:00Z',
      description: 'Cuota de marzo',
    });
    await post(
      centro.cookie,
      '/api/v1/payments',
      { memberId: socio, venueId: centro.venueId, amountCents: 500_000, method: 'cash' },
      { 'Idempotency-Key': `pago-metrics-${Date.now()}` },
    );

    await correrMetricas();

    const fila = await filaDe(centro.venueId, DIA_MEDIDO);
    expect(fila?.incomeCents).toBe(500_000);
    expect(fila?.chargedCents).toBe(1_800_000);
    /*
     * Al cierre del día el cargo ya venció y sigue debiendo: $18.000 menos los
     * $5.000 que el pago imputó. La deuda es una foto del cierre, no un flujo.
     */
    expect(fila?.overdueCents).toBe(1_300_000);
  });
});

describe('el panel', () => {
  it('🔴 lee de metricsDaily: sin job corrido, no inventa nada', async () => {
    const centro = await centroListo('panel-vacio');
    await clase(centro);
    await socioCon(centro, 'Micaela');

    const { res, body } = await panel(centro);

    /*
     * Hay una clase y un socio en la base, pero el job no corrió: si el panel
     * agregara en vivo, esto daría 1 clase. Da cero porque lee lo precalculado.
     */
    expect(res.status).toBe(200);
    expect(body.days).toBe(0);
    expect(body.sessions).toBe(0);
  });

  it('devuelve el resumen del período y el día por día', async () => {
    const centro = await centroListo('panel-resumen');
    await clase(centro);
    await correrMetricas();

    const { body } = await panel(centro, { from: '2026-03-01', to: DIA_MEDIDO });

    expect(body.days).toBe(1);
    expect(body.daily).toHaveLength(1);
    expect(body.daily[0]?.date).toBe(DIA_MEDIDO);
    expect(body.capacity).toBe(10);
  });

  it('sin fechas, mira los últimos 30 días terminando ayer', async () => {
    const centro = await centroListo('panel-default');
    await clase(centro);
    await correrMetricas();

    const { body } = await panel(centro);

    expect(body.to).toBe(DIA_MEDIDO);
    expect(body.from).toBe('2026-02-01');
    expect(body.days).toBe(1);
  });

  it('el desde posterior al hasta se rechaza', async () => {
    const centro = await centroListo('panel-rango-invertido');

    const { res, body } = await panel(centro, { from: DIA_MEDIDO, to: '2026-03-01' });

    expect(res.status).toBe(422);
    expect((body as unknown as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });

  it('🔴 el coach no ve las métricas de negocio (§2.1.12)', async () => {
    const centro = await centroListo('panel-coach');
    const coachCookie = await signUp(`coach-metrics-${++creados}@laplace.test`);
    const sesion = await auth.api.getSession({ headers: { cookie: coachCookie } });
    await auth.api.addMember({
      body: {
        userId: (sesion as { user: { id: string } }).user.id,
        organizationId: centro.organizationId,
        role: 'coach',
      },
    });
    await app.request(
      '/api/v1/auth/organization/set-active',
      req(coachCookie, 'POST', { organizationId: centro.organizationId }),
    );

    const res = await app.request(
      `/api/v1/metrics?venueId=${centro.venueId}`,
      req(coachCookie, 'GET'),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-AUTH-403-002');
  });
});

describe('el reproceso de un día pasado (§2.1.12)', () => {
  it('🔴 recalcula con los datos de ahora, no con los de aquella noche', async () => {
    const centro = await centroListo('reproceso');
    await correrMetricas();
    expect((await filaDe(centro.venueId, DIA_MEDIDO))?.sessions).toBe(0);

    // El dato aparece después: una clase que alguien cargó tarde.
    await clase(centro);
    await post(centro.cookie, '/api/v1/metrics/recompute', {
      venueId: centro.venueId,
      from: DIA_MEDIDO,
    });

    expect((await filaDe(centro.venueId, DIA_MEDIDO))?.sessions).toBe(1);
  });

  it('recalcula un rango entero y dice cuántos días tocó', async () => {
    const centro = await centroListo('reproceso-rango');

    const resultado = await post<{ recomputed: number }>(
      centro.cookie,
      '/api/v1/metrics/recompute',
      { venueId: centro.venueId, from: '2026-03-01', to: '2026-03-03' },
    );

    expect(resultado.recomputed).toBe(3);
    expect(await filaDe(centro.venueId, '2026-03-01')).not.toBeNull();
    expect(await filaDe(centro.venueId, '2026-03-03')).not.toBeNull();
  });

  it('un rango imposible de largo se rechaza en vez de colgar el pedido', async () => {
    const centro = await centroListo('reproceso-largo');

    const res = await app.request(
      '/api/v1/metrics/recompute',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        from: '2020-01-01',
        to: '2026-03-01',
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe('aislamiento de tenant', () => {
  it('🔴 el atacante no ve los KPIs del otro centro', async () => {
    const victima = await centroListo('mtr-victima');
    await clase(victima);
    await correrMetricas();
    const atacante = await centroListo('mtr-atacante');

    const res = await app.request(
      `/api/v1/metrics?venueId=${victima.venueId}`,
      req(atacante.cookie, 'GET'),
    );

    // 404 y no 403: un 403 confirmaría que la sede existe.
    expect(res.status).toBe(404);
  });

  it('el panel del atacante sale vacío, no con lo del otro', async () => {
    const victima = await centroListo('mtr-victima-2');
    await clase(victima);
    await correrMetricas();
    const atacante = await centroListo('mtr-atacante-2');

    const { body } = await panel(atacante);

    expect(body.daily).toEqual([]);
    expect(body.sessions).toBe(0);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  const esDeMetrics = (path: string) => path.startsWith('/api/v1/metrics');

  it('las dos rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter((route) => esDeMetrics(route.path));

    expect(rutas).toHaveLength(2);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await centroListo('mtr-fixtures');
    const victima = await nuevoCentro('mtr-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!esDeMetrics(route.path) || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        String(VICTIM_INCOME_CENTS),
      );
    }
  });
});
