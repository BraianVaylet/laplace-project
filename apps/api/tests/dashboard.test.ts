import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { Alert, AlertType, Dashboard } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-24. El tablero operativo del día (§5.1.2) y el panel de alertas
 * accionables (§2.1.12).
 *
 * Lo que se verifica y no se negocia: que **el coach no vea la plata** —
 * ni el bloque de cobros ni la alerta de deudores — y que cada alerta traiga
 * los ítems con los que se resuelve, no solo un número.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902150000-session-materialization-unique.cjs'),
  require('../../../migrations/20260902160000-venue-closures.cjs'),
  require('../../../migrations/20260902170000-booking-unique.cjs'),
  require('../../../migrations/20260904090000-waivers-unique.cjs'),
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

/** 09:00 del 4 de marzo en Buenos Aires. */
const AHORA = Temporal.Instant.from('2026-03-04T12:00:00Z');
let ahora = AHORA;

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

/** Una clase de hoy a las 19:00 del centro. */
async function clase(centro: Centro, overrides: Record<string, unknown> = {}) {
  return post<{ publicId: string }>(centro.cookie, '/api/v1/sessions', {
    venueId: centro.venueId,
    roomId: centro.roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    // 22:00 UTC del 4 = 19:00 del 4 en Buenos Aires.
    startAt: '2026-03-04T22:00:00Z',
    durationMin: 60,
    capacity: 16,
    ...overrides,
  });
}

async function socio(centro: Centro, nombre: string, overrides: Record<string, unknown> = {}) {
  const ficha = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    firstName: nombre,
    lastName: 'Prueba',
    venueIds: [centro.venueId],
    status: 'active',
    ...overrides,
  });

  return ficha.publicId;
}

async function darPack(centro: Centro, memberId: string, durationDays = 30) {
  const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
    name: 'Pack 8 clases',
    type: 'class_pack',
    priceCents: 6_000_000,
    credits: 8,
    durationDays,
    venueIds: [centro.venueId],
  });
  const contrato = await post<{ publicId: string }>(centro.cookie, '/api/v1/contracts', {
    memberId,
    productId: producto.publicId,
    venueId: centro.venueId,
  });
  await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/activate`, {});

  return contrato.publicId;
}

let clave = 0;
async function reservar(centro: Centro, sessionId: string, memberId: string) {
  const res = await app.request(
    '/api/v1/bookings',
    req(
      centro.cookie,
      'POST',
      { sessionId, memberId },
      { 'Idempotency-Key': `dash-${++clave}-${Date.now()}` },
    ),
  );
  if (res.status !== 201) throw new Error(`reserva falló: ${res.status} ${await res.text()}`);

  const { booking } = (await res.json()) as { booking: { publicId: string } };

  return booking.publicId;
}

type OrgRole = 'owner' | 'manager_assistant' | 'head_coach' | 'coach' | 'front_desk' | 'member';

/** Un usuario del staff con el rol pedido, con su sesión propia. */
async function staffDe(centro: Centro, role: OrgRole) {
  const cookie = await signUp(`${role}-dash-${++creados}@laplace.test`);
  const sesion = (await auth.api.getSession({ headers: { cookie } })) as { user: { id: string } };
  await auth.api.addMember({
    body: { userId: sesion.user.id, organizationId: centro.organizationId, role },
  });
  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: centro.organizationId }),
  );

  return cookie;
}

async function tablero(centro: Centro, cookie = centro.cookie) {
  const res = await app.request(`/api/v1/dashboard?venueId=${centro.venueId}`, req(cookie, 'GET'));

  return { res, body: (await res.json()) as Dashboard };
}

const alertaDe = (body: Dashboard, type: AlertType): Alert | undefined =>
  body.alerts.find((alerta) => alerta.type === type);

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_dashboard_test' });
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
  ahora = AHORA;
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
    'legalDocuments',
    'consents',
  ]) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('las clases de hoy', () => {
  it('🔴 salen con su ocupación y su hora local', async () => {
    const centro = await centroListo('clases-hoy');
    const sesion = await clase(centro);
    const uno = await socio(centro, 'Uno');
    await darPack(centro, uno);
    await reservar(centro, sesion.publicId, uno);

    const { res, body } = await tablero(centro);

    expect(res.status).toBe(200);
    expect(body.date).toBe('2026-03-04');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.startsAtLocal).toBe('19:00');
    expect(body.sessions[0]?.booked).toBe(1);
    expect(body.sessions[0]?.occupancy).toBe(0.0625);
  });

  it('los check-ins de hoy se cuentan en toda la sede', async () => {
    const centro = await centroListo('checkins');
    const sesion = await clase(centro);
    const uno = await socio(centro, 'Uno');
    await darPack(centro, uno);
    const reserva = await reservar(centro, sesion.publicId, uno);

    ahora = Temporal.Instant.from('2026-03-04T22:05:00Z');
    await post(
      centro.cookie,
      `/api/v1/bookings/${reserva}/check-in`,
      {},
      { 'Idempotency-Key': `ci-${Date.now()}` },
    );

    const { body } = await tablero(centro);
    expect(body.checkedIn).toBe(1);
    expect(body.sessions[0]?.checkedIn).toBe(1);
  });

  it('la clase de mañana no aparece: el tablero es de hoy', async () => {
    const centro = await centroListo('manana');
    await clase(centro, { startAt: '2026-03-05T22:00:00Z' });

    const { body } = await tablero(centro);

    expect(body.sessions).toEqual([]);
  });

  it('sin clases, el tablero abre igual y en cero', async () => {
    const centro = await centroListo('sin-clases');

    const { res, body } = await tablero(centro);

    expect(res.status).toBe(200);
    expect(body.sessions).toEqual([]);
    expect(body.checkedIn).toBe(0);
  });
});

describe('el panel de alertas (§2.1.12)', () => {
  it('🔴 avisa quién no viene hace dos semanas, con cuándo fue la última vez', async () => {
    const centro = await centroListo('inactivos');
    const perdido = await socio(centro, 'Perdido');
    await mongoose.connection.db
      ?.collection('members')
      .updateOne(
        { publicId: perdido },
        { $set: { lastAttendanceAt: new Date('2026-02-01T12:00:00Z') } },
      );
    const reciente = await socio(centro, 'Reciente');
    await mongoose.connection.db
      ?.collection('members')
      .updateOne(
        { publicId: reciente },
        { $set: { lastAttendanceAt: new Date('2026-03-03T12:00:00Z') } },
      );

    const { body } = await tablero(centro);
    const alerta = alertaDe(body, 'inactive_members');

    expect(alerta?.count).toBe(1);
    expect(alerta?.items[0]?.label).toBe('Perdido Prueba');
    expect(alerta?.items[0]?.detail).toContain('2026-02-01');
  });

  it('el que nunca asistió también entra: es el que hay que llamar', async () => {
    const centro = await centroListo('nunca-vino');
    await socio(centro, 'Nuevo');

    const { body } = await tablero(centro);

    expect(alertaDe(body, 'inactive_members')?.items[0]?.detail).toBe('Nunca asistió');
  });

  it('🔴 avisa qué packs vencen esta semana, con el nombre del socio', async () => {
    const centro = await centroListo('vencen');
    const micaela = await socio(centro, 'Micaela');
    // Vence a los 5 días: entra en la ventana de 7.
    await darPack(centro, micaela, 5);
    const julian = await socio(centro, 'Julian');
    // A los 60 días: no entra.
    await darPack(centro, julian, 60);

    const { body } = await tablero(centro);
    const alerta = alertaDe(body, 'expiring_contracts');

    expect(alerta?.count).toBe(1);
    expect(alerta?.items[0]?.label).toBe('Micaela Prueba');
    expect(alerta?.items[0]?.detail).toContain('Pack 8 clases');
  });

  it('avisa quién debe plata y cuánto', async () => {
    const centro = await centroListo('deudores');
    const deudor = await socio(centro, 'Deudor');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: deudor,
      venueId: centro.venueId,
      amountCents: 1_800_000,
      dueAt: '2026-03-01T12:00:00Z',
      description: 'Cuota de marzo',
    });

    const { body } = await tablero(centro);
    const alerta = alertaDe(body, 'debtors');

    expect(alerta?.count).toBe(1);
    expect(alerta?.items[0]?.detail).toBe('Debe $18.000');
  });

  it('🔴 avisa las clases flojas de esta semana, con cuántos hay de cuántos', async () => {
    const centro = await centroListo('baja-ocupacion');
    // Una clase de pasado mañana con 16 lugares y nadie anotado.
    await clase(centro, { startAt: '2026-03-06T22:00:00Z', name: 'Pilates' });

    const { body } = await tablero(centro);
    const alerta = alertaDe(body, 'low_occupancy');

    expect(alerta?.count).toBe(1);
    expect(alerta?.items[0]?.label).toBe('Pilates');
    expect(alerta?.items[0]?.detail).toContain('0 de 16');
  });

  it('la clase de la semana pasada no entra: ya no hay nada que hacer', async () => {
    const centro = await centroListo('semana-pasada');
    ahora = Temporal.Instant.from('2026-02-25T12:00:00Z');
    await clase(centro, { startAt: '2026-02-25T22:00:00Z', name: 'Vieja' });
    ahora = AHORA;

    const { body } = await tablero(centro);

    expect(alertaDe(body, 'low_occupancy')?.count).toBe(0);
  });

  it('🔴 avisa a quién le falta firmar un documento obligatorio', async () => {
    const centro = await centroListo('sin-waiver');
    await socio(centro, 'SinFirmar');
    await post(centro.cookie, '/api/v1/legal-documents', {
      type: 'liability_waiver',
      title: 'Deslinde',
      contentHtml: '<p>Entreno bajo mi propia responsabilidad.</p>',
      required: true,
    });

    const { body } = await tablero(centro);
    const alerta = alertaDe(body, 'missing_waivers');

    expect(alerta?.count).toBe(1);
    expect(alerta?.items[0]?.label).toBe('SinFirmar Prueba');
  });

  it('sin documentos publicados, nadie debe nada', async () => {
    const centro = await centroListo('sin-documentos');
    await socio(centro, 'Alguien');

    const { body } = await tablero(centro);

    expect(alertaDe(body, 'missing_waivers')?.count).toBe(0);
  });

  it('la lista se recorta a cinco, pero el total dice la verdad', async () => {
    const centro = await centroListo('recorte');
    for (const nombre of ['Ana', 'Beto', 'Cami', 'Dani', 'Eli', 'Fran', 'Gabi']) {
      await socio(centro, nombre);
    }

    const { body } = await tablero(centro);
    const alerta = alertaDe(body, 'inactive_members');

    expect(alerta?.count).toBe(7);
    expect(alerta?.items).toHaveLength(5);
  });
});

describe('lo que el coach no ve (§2.1.12)', () => {
  it('🔴 el coach abre el tablero pero sin los cobros', async () => {
    const centro = await centroListo('coach-tablero');
    await clase(centro);
    const coach = await staffDe(centro, 'coach');

    const { res, body } = await tablero(centro, coach);

    // Entra: el tablero operativo es su pantalla de trabajo.
    expect(res.status).toBe(200);
    expect(body.sessions).toHaveLength(1);
    /*
     * `money` ausente y no en cero: un cero se lee como "no entró plata hoy",
     * y lo que pasa es que esa persona no tiene por qué saberlo.
     */
    expect(body.money).toBeUndefined();
  });

  it('🔴 el coach tampoco ve la alerta de deudores', async () => {
    const centro = await centroListo('coach-deudores');
    const deudor = await socio(centro, 'Deudor');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: deudor,
      venueId: centro.venueId,
      amountCents: 1_800_000,
      dueAt: '2026-03-01T12:00:00Z',
      description: 'Cuota',
    });
    const coach = await staffDe(centro, 'coach');

    const { body } = await tablero(centro, coach);

    expect(alertaDe(body, 'debtors')).toBeUndefined();
    // Las otras alertas sí le llegan: son operativas, no de plata.
    expect(alertaDe(body, 'inactive_members')).toBeDefined();
  });

  it('el mostrador sí ve los cobros: cobra', async () => {
    const centro = await centroListo('front-desk');
    const frontDesk = await staffDe(centro, 'front_desk');

    const { body } = await tablero(centro, frontDesk);

    expect(body.money).toBeDefined();
  });

  it('el owner ve todo', async () => {
    const centro = await centroListo('owner');

    const { body } = await tablero(centro);

    expect(body.money).toBeDefined();
    expect(alertaDe(body, 'debtors')).toBeDefined();
  });
});

describe('aislamiento de tenant', () => {
  it('🔴 el atacante no abre el tablero de la sede del otro centro', async () => {
    const victima = await centroListo('dash-victima');
    await clase(victima);
    const atacante = await centroListo('dash-atacante');

    const res = await app.request(
      `/api/v1/dashboard?venueId=${victima.venueId}`,
      req(atacante.cookie, 'GET'),
    );

    // 404 y no 403: un 403 confirmaría que la sede existe.
    expect(res.status).toBe(404);
  });

  it('el tablero del atacante no trae socios ni clases del otro', async () => {
    const victima = await centroListo('dash-victima-2');
    await clase(victima);
    await socio(victima, 'Secreto');
    const atacante = await centroListo('dash-atacante-2');

    const { body } = await tablero(atacante);

    expect(body.sessions).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('Secreto');
  });
});

describe('el socio del mismo centro', () => {
  /*
   * El tablero estaba gateado con `classSession.read`, que el socio también
   * tiene —lo necesita para ver la agenda desde la WAFM—. Pidiendo
   * `/api/v1/dashboard?venueId=` se llevaba el panel de alertas entero: los
   * nombres de sus compañeros, quiénes dejaron de venir y a quiénes les vence
   * el pack. El aislamiento por tenant no lo tapa: es su propio centro.
   */
  it('🔴 NO abre el tablero del centro ni ve a sus compañeros', async () => {
    const centro = await centroListo('socio-tablero');
    await socio(centro, 'Secreto');
    const cookie = await staffDe(centro, 'member');

    const res = await app.request(
      `/api/v1/dashboard?venueId=${centro.venueId}`,
      req(cookie, 'GET'),
    );
    const texto = await res.text();

    expect(res.status).toBe(403);
    expect(JSON.parse(texto).error.code).toBe('LP-AUTH-403-002');
    expect(texto).not.toContain('Secreto');
  });

  it('el mostrador del mismo centro sí lo abre y sí los ve', async () => {
    const centro = await centroListo('mostrador-tablero');
    await socio(centro, 'Secreto');
    const frontDesk = await staffDe(centro, 'front_desk');

    const { res, body } = await tablero(centro, frontDesk);

    expect(res.status).toBe(200);
    expect(alertaDe(body, 'inactive_members')?.items.map((item) => item.label)).toContain(
      'Secreto Prueba',
    );
  });
});

describe('la ruta queda cubierta por la suite de F0-05', () => {
  it('trae su fixture de ataque', () => {
    const ruta = allRegisteredRoutes().find((route) => route.path === '/api/v1/dashboard');

    expect(ruta?.tenantScoped).toBe(true);
    expect(ruta?.isolationFixture).toBeDefined();
  });
});
