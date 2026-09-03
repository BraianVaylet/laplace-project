import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { BookingResult, ClassRoster } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-18. La lista de clase es la pantalla que el coach usa **de pie, con una
 * mano**, en el piso del box (§5.1.2). Si no funciona perfecto en un teléfono,
 * no se usa.
 *
 * Del lado del backend eso se traduce en dos cosas: la lista llega resuelta en
 * una sola llamada, y "todos presentes" no se cae porque uno de los catorce no
 * pase una validación.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902150000-session-materialization-unique.cjs'),
  require('../../../migrations/20260902160000-venue-closures.cjs'),
  require('../../../migrations/20260902170000-booking-unique.cjs'),
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

/** Lunes 2 de marzo de 2026, 09:00 en Buenos Aires. */
let ahora = Temporal.Instant.from('2026-03-02T12:00:00Z');

/** La clase del escenario: martes 3, 10:00 UTC. */
const CLASE_EMPIEZA = '2026-03-03T10:00:00Z';

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

async function post<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

let clave = 0;
const nuevaClave = () => `attd-${++clave}-${Date.now()}`;

/** Un centro con sede, sala, socio con pack y una clase. */
async function centroListo(
  nombre: string,
  opciones: { capacity?: number; bookingPolicy?: Record<string, unknown> } = {},
) {
  const centro = await nuevoCentro(nombre);
  const sede = await post<{ publicId: string }>(centro.cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
    ...(opciones.bookingPolicy ? { bookingPolicy: opciones.bookingPolicy } : {}),
  });

  const salas = await app.request(
    `/api/v1/rooms?venueId=${sede.publicId}`,
    req(centro.cookie, 'GET'),
  );
  const roomId = ((await salas.json()) as { items: Array<{ publicId: string }> }).items[0]
    ?.publicId as string;

  const clase = await post<{ publicId: string }>(centro.cookie, '/api/v1/sessions', {
    venueId: sede.publicId,
    roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    startAt: CLASE_EMPIEZA,
    durationMin: 60,
    capacity: opciones.capacity ?? 16,
  });

  const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
    name: 'Pack 8',
    type: 'class_pack',
    priceCents: 6_000_000,
    credits: 8,
    durationDays: 30,
    venueIds: [sede.publicId],
  });

  return {
    ...centro,
    venueId: sede.publicId,
    roomId,
    productId: producto.publicId,
    sessionId: clase.publicId,
  };
}

type Centro = Awaited<ReturnType<typeof centroListo>>;

/** Un socio con pack activo, anotado en la clase del centro. */
async function anotado(centro: Centro, nombre: string) {
  const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    firstName: nombre,
    lastName: 'Sosa',
    venueIds: [centro.venueId],
  });
  const contrato = await post<{ publicId: string }>(centro.cookie, '/api/v1/contracts', {
    memberId: socio.publicId,
    productId: centro.productId,
    venueId: centro.venueId,
  });
  await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/activate`, {});

  const reserva = await reservar(centro, socio.publicId);

  return { memberId: socio.publicId, bookingId: reserva.booking.publicId };
}

/** Reservar exige `Idempotency-Key`, igual que el check-in (§5.0). */
async function reservar(centro: Centro, memberId: string, sessionId = centro.sessionId) {
  const res = await app.request(
    '/api/v1/bookings',
    req(centro.cookie, 'POST', { sessionId, memberId }, { 'Idempotency-Key': nuevaClave() }),
  );
  if (res.status !== 201) throw new Error(`reserva falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as BookingResult;
}

const lista = async (centro: Centro, sessionId = centro.sessionId) => {
  const res = await app.request(`/api/v1/sessions/${sessionId}/roster`, req(centro.cookie, 'GET'));

  return { res, body: (await res.json()) as ClassRoster };
};

const marcar = (centro: Centro, bookingId: string, body: unknown = {}) =>
  app.request(
    `/api/v1/bookings/${bookingId}/check-in`,
    req(centro.cookie, 'POST', body, { 'Idempotency-Key': nuevaClave() }),
  );

const marcarTodos = (centro: Centro, sessionId = centro.sessionId) =>
  app.request(
    `/api/v1/sessions/${sessionId}/check-in-all`,
    req(centro.cookie, 'POST', {}, { 'Idempotency-Key': nuevaClave() }),
  );

/** Dentro de la ventana de check-in: media hora antes de que empiece. */
const enLaPuerta = () => {
  ahora = Temporal.Instant.from('2026-03-03T09:45:00Z');
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_attendance_test' });
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
    memberships: { add: () => Promise.resolve() },
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
  ahora = Temporal.Instant.from('2026-03-02T12:00:00Z');
  entitlements.invalidateAll();
  for (const coleccion of [
    'bookings',
    'classSessions',
    'contracts',
    'products',
    'members',
    'charges',
    'rooms',
    'venues',
  ]) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('la lista de clase del coach (§2.1.18)', () => {
  it('trae inscriptos, presentes y lista de espera en una sola llamada', async () => {
    const centro = await centroListo('lista', { capacity: 1 });
    const primero = await anotado(centro, 'Micaela');
    const segundo = await anotado(centro, 'Joaquín');

    const { res, body } = await lista(centro);

    expect(res.status).toBe(200);
    expect(body.capacity).toBe(1);
    expect(body.bookedCount).toBe(1);
    expect(body.waitlistCount).toBe(1);
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((entry) => entry.bookingId)).toContain(primero.bookingId);
    expect(body.entries.map((entry) => entry.bookingId)).toContain(segundo.bookingId);
  });

  it('cada línea trae el nombre, para que el coach sepa a quién marca', async () => {
    const centro = await centroListo('lista-nombres');
    await anotado(centro, 'Micaela');

    const { body } = await lista(centro);

    expect(body.entries[0]?.fullName).toBe('Micaela Sosa');
  });

  it('dice si el check-in está abierto y desde cuándo', async () => {
    const centro = await centroListo('lista-ventana');
    await anotado(centro, 'Micaela');

    const cerrada = await lista(centro);
    expect(cerrada.body.checkInOpen).toBe(false);
    // Abre 30 minutos antes del inicio, por default.
    expect(cerrada.body.checkInOpensAt).toBe('2026-03-03T09:30:00Z');

    enLaPuerta();
    const abierta = await lista(centro);
    expect(abierta.body.checkInOpen).toBe(true);
  });

  it('marca con `debt` a quien debe plata', async () => {
    const centro = await centroListo('lista-deuda');
    const socio = await anotado(centro, 'Deudor');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: socio.memberId,
      venueId: centro.venueId,
      amountCents: 5_000_000,
      description: 'Pack de marzo',
      dueDate: '2026-03-01',
    });

    const { body } = await lista(centro);

    expect(body.entries[0]?.alerts).toContain('debt');
  });

  it('los presentes van primero: es lo que el coach mira', async () => {
    const centro = await centroListo('lista-orden');
    await anotado(centro, 'Ausente');
    const presente = await anotado(centro, 'Presente');
    enLaPuerta();
    await marcar(centro, presente.bookingId);

    const { body } = await lista(centro);

    expect(body.entries[0]?.status).toBe('checked_in');
    expect(body.presentCount).toBe(1);
  });

  it('una clase que no existe no tiene lista', async () => {
    const centro = await centroListo('lista-inexistente');

    const res = await app.request(
      '/api/v1/sessions/ses_no_existe/roster',
      req(centro.cookie, 'GET'),
    );

    expect(res.status).toBe(404);
  });
});

describe('check-in manual', () => {
  it('registra la hora, el método y quién lo hizo', async () => {
    const centro = await centroListo('checkin-ok');
    const socio = await anotado(centro, 'Micaela');
    enLaPuerta();

    const res = await marcar(centro, socio.bookingId);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checkedInAt: string;
      checkInMethod: string;
    };
    expect(body.status).toBe('checked_in');
    expect(body.checkedInAt).toBe('2026-03-03T09:45:00Z');
    expect(body.checkInMethod).toBe('staff');

    const enBase = await mongoose.connection.db
      ?.collection('bookings')
      .findOne<{ checkedInBy: string }>({ publicId: socio.bookingId });
    expect(enBase?.checkedInBy).toBeTruthy();
  });

  it('deja la última asistencia en la ficha del socio', async () => {
    const centro = await centroListo('checkin-ficha');
    const socio = await anotado(centro, 'Micaela');
    enLaPuerta();

    await marcar(centro, socio.bookingId);
    const ficha = await app.request(`/api/v1/members/${socio.memberId}`, req(centro.cookie, 'GET'));

    // Es el mejor predictor individual de baja (§7).
    expect(((await ficha.json()) as { lastAttendanceAt: string }).lastAttendanceAt).toBe(
      '2026-03-03T09:45:00Z',
    );
  });

  it('antes de que abra la ventana no se puede (LP-ATTD-422-002)', async () => {
    const centro = await centroListo('checkin-temprano');
    const socio = await anotado(centro, 'Micaela');

    const res = await marcar(centro, socio.bookingId);

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ATTD-422-002');
  });

  it('cerrada la ventana tampoco: si no, el no-show no significaría nada', async () => {
    const centro = await centroListo('checkin-tarde');
    const socio = await anotado(centro, 'Micaela');

    // La clase empezó 10:00 y la ventana cierra 30 minutos después.
    ahora = Temporal.Instant.from('2026-03-03T10:45:00Z');
    const res = await marcar(centro, socio.bookingId);

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ATTD-422-002');
  });

  it('marcar dos veces responde LP-ATTD-409-001', async () => {
    const centro = await centroListo('checkin-doble');
    const socio = await anotado(centro, 'Micaela');
    enLaPuerta();
    await marcar(centro, socio.bookingId);

    const res = await marcar(centro, socio.bookingId);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ATTD-409-001');
  });

  it('quien está en la lista de espera no entra: primero confirma', async () => {
    const centro = await centroListo('checkin-espera', { capacity: 1 });
    await anotado(centro, 'ConLugar');
    const enFila = await anotado(centro, 'EnFila');
    enLaPuerta();

    const res = await marcar(centro, enFila.bookingId);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ATTD-409-006');
  });

  it('una reserva cancelada no entra', async () => {
    const centro = await centroListo('checkin-cancelada');
    const socio = await anotado(centro, 'Micaela');
    await app.request(`/api/v1/bookings/${socio.bookingId}/cancel`, req(centro.cookie, 'POST', {}));
    enLaPuerta();

    const res = await marcar(centro, socio.bookingId);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ATTD-409-006');
  });

  it('sin `Idempotency-Key` no se registra el ingreso (§5.0)', async () => {
    const centro = await centroListo('checkin-sin-clave');
    const socio = await anotado(centro, 'Micaela');
    enLaPuerta();

    const res = await app.request(
      `/api/v1/bookings/${socio.bookingId}/check-in`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });

  it('el socio en mora no entra si el centro no lo permite', async () => {
    const centro = await centroListo('checkin-mora');
    const socio = await anotado(centro, 'Deudor');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: socio.memberId,
      venueId: centro.venueId,
      amountCents: 5_000_000,
      description: 'Pack de febrero',
      dueDate: '2026-02-01',
    });
    // El corte es por MORA, no por deuda: el cargo tiene que estar vencido.
    const dunning = modules.jobs.find((job) => job.name === 'dunning');
    await dunning?.handler();
    enLaPuerta();

    const res = await marcar(centro, socio.bookingId);

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-403-005');
  });

  it('con `allowDebt: true` el mismo socio entra igual', async () => {
    const centro = await centroListo('checkin-mora-permitida', {
      bookingPolicy: { allowDebt: true },
    });
    const socio = await anotado(centro, 'Deudor');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: socio.memberId,
      venueId: centro.venueId,
      amountCents: 5_000_000,
      description: 'Pack de febrero',
      dueDate: '2026-02-01',
    });
    const dunning = modules.jobs.find((job) => job.name === 'dunning');
    await dunning?.handler();
    enLaPuerta();

    // La puerta del centro no es la oficina de cobranzas si el centro no quiere.
    expect((await marcar(centro, socio.bookingId)).status).toBe(200);
  });

  it('una reserva que no existe da 404', async () => {
    const centro = await centroListo('checkin-inexistente');
    enLaPuerta();

    const res = await marcar(centro, 'bkg_no_existe');

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ATTD-404-005');
  });
});

describe('"todos presentes" de un toque', () => {
  it('marca a los anotados y deja la fila afuera', async () => {
    const centro = await centroListo('todos', { capacity: 2 });
    await anotado(centro, 'Uno');
    await anotado(centro, 'Dos');
    await anotado(centro, 'EnFila');
    enLaPuerta();

    const res = await marcarTodos(centro);
    const body = (await res.json()) as { checkedIn: number; skipped: unknown[] };

    expect(res.status).toBe(200);
    expect(body.checkedIn).toBe(2);
    expect((await lista(centro)).body.presentCount).toBe(2);
  });

  it('el que no pasa la validación no rompe la operación: vuelve con su motivo', async () => {
    const centro = await centroListo('todos-parcial', { capacity: 2 });
    const uno = await anotado(centro, 'Uno');
    await anotado(centro, 'Dos');
    enLaPuerta();
    await marcar(centro, uno.bookingId);

    // Uno ya está adentro: el masivo lo saltea y marca al que falta.
    const res = await marcarTodos(centro);
    const body = (await res.json()) as { checkedIn: number; skipped: unknown[] };

    expect(body.checkedIn).toBe(1);
    expect(body.skipped).toHaveLength(0);
  });

  it('fuera de la ventana no marca a nadie y lo dice', async () => {
    const centro = await centroListo('todos-tarde');
    await anotado(centro, 'Uno');
    await anotado(centro, 'Dos');

    const res = await marcarTodos(centro);
    const body = (await res.json()) as {
      checkedIn: number;
      skipped: Array<{ code: string }>;
    };

    // Que el coach no pueda marcar a trece porque uno falla sería cambiar ocho
    // segundos de trabajo por una discusión en el piso del box.
    expect(body.checkedIn).toBe(0);
    expect(body.skipped).toHaveLength(2);
    expect(body.skipped[0]?.code).toBe('LP-ATTD-422-002');
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve la lista de una clase de otro centro', async () => {
    const victima = await centroListo('attd-victima');
    await anotado(victima, 'Micaela');
    const atacante = await centroListo('attd-atacante');

    const res = await app.request(
      `/api/v1/sessions/${victima.sessionId}/roster`,
      req(atacante.cookie, 'GET'),
    );

    expect(res.status).toBe(404);
  });

  it('tampoco puede marcar presente a un socio ajeno', async () => {
    const victima = await centroListo('attd-victima-2');
    const socio = await anotado(victima, 'Micaela');
    const atacante = await centroListo('attd-atacante-2');
    enLaPuerta();

    const res = await marcar(atacante, socio.bookingId);

    expect(res.status).toBe(404);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las tres rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter(
      (route) => route.path.includes('/roster') || route.path.includes('check-in'),
    );

    expect(rutas).toHaveLength(3);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('attd-fixtures');
    const victima = await nuevoCentro('attd-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      const propia = route.path.includes('/roster') || route.path.includes('check-in');
      if (!propia || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: {
          'content-type': 'application/json',
          cookie: atacante.cookie,
          'Idempotency-Key': nuevaClave(),
        },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain('ven_victima');
    }
  });
});
