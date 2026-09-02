import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { BookingResult } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-14. El corazón del producto y su condición de carrera clásica: dos personas
 * tomando el último lugar a las 6:00 de la mañana.
 *
 * Lo que se verifica y no se negocia: **50 reservas paralelas sobre 1 cupo → una
 * sola reserva y nunca sobreventa** (§Testing.2), la idempotencia, y la
 * compensación cuando la creación falla después del descuento.
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
let bus: ReturnType<typeof createEventBus>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'pro' }));

/** Lunes 2 de marzo de 2026, 09:00 en Buenos Aires. */
let ahora = Temporal.Instant.from('2026-03-02T12:00:00Z');

interface SessionBody {
  publicId: string;
  capacity: number;
  bookedCount: number;
  waitlistCount: number;
  startAt: string;
}
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

/**
 * Un centro completo: sede, sala, socio con pack activo y una clase con cupo.
 * Es el escenario mínimo para poder reservar.
 */
async function centroListo(
  nombre: string,
  opciones: { capacity?: number; credits?: number; bookingPolicy?: Record<string, unknown> } = {},
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

  const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    firstName: 'Micaela',
    lastName: 'Sosa',
    venueIds: [sede.publicId],
  });

  const clase = await post<SessionBody>(centro.cookie, '/api/v1/sessions', {
    venueId: sede.publicId,
    roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    startAt: '2026-03-03T10:00:00Z',
    durationMin: 60,
    capacity: opciones.capacity ?? 16,
  });

  return {
    ...centro,
    venueId: sede.publicId,
    roomId,
    memberId: socio.publicId,
    sessionId: clase.publicId,
  };
}

type Centro = Awaited<ReturnType<typeof centroListo>>;

/** Le vende un pack al socio indicado y lo activa. */
async function darPack(centro: Centro, memberId: string, credits = 8) {
  const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
    name: `Pack ${credits}`,
    type: 'class_pack',
    priceCents: 6_000_000,
    credits,
    durationDays: 30,
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

/** Da de alta un socio más en el mismo centro y le vende un pack. */
async function socioCon(centro: Centro, nombre: string, credits = 8) {
  const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    firstName: nombre,
    lastName: 'Prueba',
    venueIds: [centro.venueId],
  });
  await darPack(centro, socio.publicId, credits);

  return socio.publicId;
}

const correrJob = async (name: string) => {
  const job = modules.jobs.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`no existe el job ${name}`);

  await job.handler();
};

/** El contrato activo de un socio, para mirarle los créditos. */
async function contratoDe(memberId: string): Promise<string> {
  const doc = await mongoose.connection.db
    ?.collection('contracts')
    .findOne<{ publicId: string }>({ memberId, status: 'active' });

  return String(doc?.publicId);
}

let clave = 0;
const nuevaClave = () => `bkg-${++clave}-${Date.now()}`;

function reservar(centro: Centro, memberId: string, key = nuevaClave()) {
  return app.request(
    '/api/v1/bookings',
    req(
      centro.cookie,
      'POST',
      { sessionId: centro.sessionId, memberId },
      { 'Idempotency-Key': key },
    ),
  );
}

async function reservarOk(centro: Centro, memberId: string, key = nuevaClave()) {
  const res = await reservar(centro, memberId, key);
  if (res.status !== 201) throw new Error(`reserva falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as BookingResult;
}

const claseEnBase = async (sessionId: string) =>
  mongoose.connection.db
    ?.collection('classSessions')
    .findOne<{ bookedCount: number; capacity: number; waitlistCount: number; status: string }>({
      publicId: sessionId,
    });

const contratoEnBase = async (contractId: string) =>
  mongoose.connection.db
    ?.collection('contracts')
    .findOne<{ creditsUsed: number }>({ publicId: contractId });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_booking_test' });
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5174'],
    emailSender,
    rateLimitEnabled: false,
  });

  bus = createEventBus(logger);
  modules = createModules({
    events: bus,
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

/**
 * Un socio con sesión propia: canjea un código de invitación y queda ligado a
 * su ficha. Es el camino de la WAFM, y el único donde `memberId` no viaja en el
 * cuerpo del pedido.
 */
async function atletaDe(centro: Centro, nombre: string) {
  const codigo = await post<{ code: string }>(centro.cookie, '/api/v1/invite-codes', {
    venueId: centro.venueId,
    maxUses: 5,
    expiresAt: '2026-12-31T00:00:00Z',
  });

  const cookie = await signUp(`${nombre}-${++creados}@laplace.test`);
  const canje = await post<{ memberId: string; organizationId: string }>(
    cookie,
    '/api/v1/invite-codes/redeem',
    { code: codigo.code, firstName: nombre, lastName: 'Socio' },
  );

  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: canje.organizationId }),
  );

  return { cookie, memberId: canje.memberId };
}

/** Un usuario del centro con rol `member` pero sin ficha: nunca canjeó nada. */
async function usuarioSinFicha(centro: Centro, nombre: string) {
  const cookie = await signUp(`${nombre}-${++creados}@laplace.test`);
  const sesion = await auth.api.getSession({ headers: new Headers({ cookie }) });
  await auth.api.addMember({
    body: {
      userId: sesion?.user.id as string,
      organizationId: centro.organizationId,
      role: 'member',
    },
  });
  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: centro.organizationId }),
  );

  return cookie;
}

/** Reserva en una clase que no es la del escenario base. */
async function reservarEn(centro: Centro, sessionId: string, memberId: string) {
  const res = await app.request(
    '/api/v1/bookings',
    req(centro.cookie, 'POST', { sessionId, memberId }, { 'Idempotency-Key': nuevaClave() }),
  );
  if (res.status !== 201) throw new Error(`reserva falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as BookingResult;
}

/** Otra clase en la misma sede, para tener más de una reserva por socio. */
async function otraClase(centro: Centro, startAt: string) {
  const clase = await post<SessionBody>(centro.cookie, '/api/v1/sessions', {
    venueId: centro.venueId,
    roomId: centro.roomId,
    name: 'Funcional tarde',
    categoryId: 'funcional',
    startAt,
    durationMin: 60,
    capacity: 16,
  });

  return clase.publicId;
}

describe('reserva', () => {
  it('sube el `bookedCount` y descuenta un crédito en la misma operación', async () => {
    const centro = await centroListo('reserva');
    const contractId = await darPack(centro, centro.memberId, 8);

    const resultado = await reservarOk(centro, centro.memberId);

    expect(resultado.booking.status).toBe('booked');
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(1);
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(1);
  });

  it('dice de qué pack salió el crédito (§2.1.9)', async () => {
    const centro = await centroListo('explicable');
    await darPack(centro, centro.memberId, 8);

    const resultado = await reservarOk(centro, centro.memberId);

    expect(resultado.consumption?.creditsLeft).toBe(7);
    expect(resultado.consumption?.reason).toContain('vence primero');
  });

  it('emite `booking.created`', async () => {
    const centro = await centroListo('evento');
    await darPack(centro, centro.memberId);
    const vistos: Array<{ sessionId: string; memberId: string }> = [];
    bus.on('booking.created', (payload) => {
      vistos.push({ sessionId: payload.sessionId, memberId: payload.memberId });
    });

    const reserva = await reservarOk(centro, centro.memberId);

    // De este evento cuelgan las notificaciones de F1-22: sin él, el socio
    // reserva y nunca se entera.
    expect(vistos).toEqual([{ sessionId: centro.sessionId, memberId: centro.memberId }]);
    expect(reserva.booking.status).toBe('booked');
  });

  it('el mismo socio no reserva dos veces la misma clase', async () => {
    const centro = await centroListo('doble');
    await darPack(centro, centro.memberId);
    await reservarOk(centro, centro.memberId);

    const res = await reservar(centro, centro.memberId);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-409-001');
  });

  it('sin contrato no se reserva', async () => {
    const centro = await centroListo('sin-pack');

    const res = await reservar(centro, centro.memberId);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(402);
    expect(body.error.code).toBe('LP-CTRT-402-001');
    // El lugar no quedó tomado: se compensa hacia atrás.
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(0);
  });

  it('con el pack agotado tampoco, y el lugar vuelve a la clase', async () => {
    const centro = await centroListo('pack-agotado');
    await darPack(centro, centro.memberId, 1);
    const otro = await socioCon(centro, 'Otra', 8);
    await reservarOk(centro, centro.memberId);

    // Segunda clase para el mismo socio: ya no le quedan créditos.
    const otraClase = await post<SessionBody>(centro.cookie, '/api/v1/sessions', {
      venueId: centro.venueId,
      roomId: centro.roomId,
      name: 'Funcional tarde',
      categoryId: 'funcional',
      startAt: '2026-03-03T18:00:00Z',
      durationMin: 60,
    });
    const res = await app.request(
      '/api/v1/bookings',
      req(
        centro.cookie,
        'POST',
        { sessionId: otraClase.publicId, memberId: centro.memberId },
        { 'Idempotency-Key': nuevaClave() },
      ),
    );

    expect(res.status).toBe(402);
    // Un lugar tomado por una reserva que nunca existió es un lugar que nadie
    // puede usar.
    expect((await claseEnBase(otraClase.publicId))?.bookedCount).toBe(0);
    expect(otro).toBeTruthy();
  });

  it('una clase que ya empezó no se reserva', async () => {
    const centro = await centroListo('empezada');
    await darPack(centro, centro.memberId);
    ahora = Temporal.Instant.from('2026-03-04T12:00:00Z');

    const res = await reservar(centro, centro.memberId);

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-422-003');
  });

  it('una clase cancelada no se reserva', async () => {
    const centro = await centroListo('cancelada');
    await darPack(centro, centro.memberId);
    await post(centro.cookie, `/api/v1/sessions/${centro.sessionId}/cancel`, {
      reason: 'Se cortó la luz.',
    });

    const res = await reservar(centro, centro.memberId);

    expect(res.status).toBe(404);
  });

  it('sin `Idempotency-Key` no se reserva', async () => {
    const centro = await centroListo('sin-clave');
    await darPack(centro, centro.memberId);

    const res = await app.request(
      '/api/v1/bookings',
      req(centro.cookie, 'POST', { sessionId: centro.sessionId, memberId: centro.memberId }),
    );

    // El socio que toca dos veces "Reservar" gastaría dos créditos.
    expect(res.status).toBe(422);
  });

  it('la misma clave devuelve la misma reserva, no una segunda', async () => {
    const centro = await centroListo('idempotente');
    const contractId = await darPack(centro, centro.memberId, 8);
    const key = nuevaClave();

    const primera = await reservarOk(centro, centro.memberId, key);
    const segunda = await reservarOk(centro, centro.memberId, key);

    expect(segunda.booking.publicId).toBe(primera.booking.publicId);
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(1);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(1);
  });
});

describe('🔴 concurrencia: el último lugar (§Testing.2)', () => {
  it('50 reservas paralelas sobre 1 cupo: una entra, 49 a la lista de espera', async () => {
    // La fila entra entera a propósito: lo que se prueba acá es el cupo, no el
    // tope de la lista de espera, que tiene su propio test.
    const centro = await centroListo('concurrencia', {
      capacity: 1,
      bookingPolicy: { waitlistMaxSize: 60 },
    });
    const socios = await Promise.all(
      Array.from({ length: 50 }, (_, i) => socioCon(centro, `Socio${i}`, 8)),
    );

    const resultados = await Promise.all(socios.map((memberId) => reservar(centro, memberId)));
    const cuerpos = await Promise.all(
      resultados.map((res) => res.json() as Promise<BookingResult>),
    );

    /*
     * El lugar se toma con un `findOneAndUpdate` que exige
     * `bookedCount < capacity` en la misma operación. Con un `read` y después un
     * `write`, los cincuenta leerían `bookedCount: 0` y entrarían los cincuenta:
     * a las 6:05 hay 49 personas paradas afuera.
     */
    const reservados = cuerpos.filter((body) => body.booking?.status === 'booked');
    const enEspera = cuerpos.filter((body) => body.booking?.status === 'waitlisted');

    expect(reservados).toHaveLength(1);
    expect(enEspera).toHaveLength(49);

    const clase = await claseEnBase(centro.sessionId);
    // 🔴 Nunca hay sobreventa.
    expect(clase?.bookedCount).toBe(1);
    expect(clase?.bookedCount).toBeLessThanOrEqual(clase?.capacity ?? 0);
    expect(clase?.waitlistCount).toBe(49);
  }, 60_000);

  it('la lista de espera NO consume crédito', async () => {
    const centro = await centroListo('espera-sin-credito', { capacity: 1 });
    const primero = await socioCon(centro, 'Primero', 8);
    const segundo = await socioCon(centro, 'Segundo', 8);
    await reservarOk(centro, primero);

    const enEspera = await reservarOk(centro, segundo);
    const contratos = await mongoose.connection.db
      ?.collection('contracts')
      .find<{ memberId: string; creditsUsed: number }>({ memberId: segundo })
      .toArray();

    // Todavía no tiene lugar: cobrárselo por esperar sería cobrarle por nada.
    expect(enEspera.booking.status).toBe('waitlisted');
    expect(enEspera.booking.waitlistPosition).toBe(1);
    expect(contratos?.[0]?.creditsUsed).toBe(0);
  });

  it('las posiciones de la fila son consecutivas', async () => {
    const centro = await centroListo('fila', { capacity: 1 });
    const socios = await Promise.all(
      Array.from({ length: 4 }, (_, i) => socioCon(centro, `Fila${i}`, 8)),
    );
    for (const memberId of socios) await reservarOk(centro, memberId);

    const espera = await mongoose.connection.db
      ?.collection('bookings')
      .find<{ waitlistPosition: number }>({ status: 'waitlisted' })
      .sort({ waitlistPosition: 1 })
      .toArray();

    expect(espera?.map((booking) => booking.waitlistPosition)).toEqual([1, 2, 3]);
  });
});

describe('cancelación de una reserva', () => {
  it('devuelve el lugar y el crédito', async () => {
    const centro = await centroListo('cancelar');
    const contractId = await darPack(centro, centro.memberId, 8);
    const reserva = await reservarOk(centro, centro.memberId);

    const res = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(200);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(0);
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(0);
  });

  it('cancelar desde la lista de espera solo saca de la fila', async () => {
    const centro = await centroListo('cancelar-espera', { capacity: 1 });
    const primero = await socioCon(centro, 'Primero', 8);
    const segundo = await socioCon(centro, 'Segundo', 8);
    await reservarOk(centro, primero);
    const enEspera = await reservarOk(centro, segundo);

    await app.request(
      `/api/v1/bookings/${enEspera.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );
    const clase = await claseEnBase(centro.sessionId);

    // Nunca tuvo lugar ni crédito.
    expect(clase?.bookedCount).toBe(1);
    expect(clase?.waitlistCount).toBe(0);
  });

  it('cancelar dos veces no devuelve dos créditos', async () => {
    const centro = await centroListo('cancelar-doble');
    const contractId = await darPack(centro, centro.memberId, 8);
    const reserva = await reservarOk(centro, centro.memberId);
    await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    const res = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(409);
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(0);
  });

  it('quien canceló puede volver a reservar la misma clase', async () => {
    const centro = await centroListo('recancelar');
    await darPack(centro, centro.memberId, 8);
    const reserva = await reservarOk(centro, centro.memberId);
    await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    /*
     * Es lo que arregla el índice parcial de esta tarea: el de F0-10 era único
     * sin filtro y bloqueaba para siempre a quien se equivocó de horario.
     */
    const res = await reservar(centro, centro.memberId);
    expect(res.status).toBe(201);
  });
});

describe('las tres deudas heredadas, saldadas', () => {
  it('F1-11: el socio en mora no puede reservar (LP-BOOK-403-005)', async () => {
    const centro = await centroListo('deuda-mora');
    await darPack(centro, centro.memberId, 8);
    await post(centro.cookie, '/api/v1/charges', {
      memberId: centro.memberId,
      venueId: centro.venueId,
      amountCents: 6_000_000,
      description: 'Cuota de marzo',
      dueAt: '2026-02-01T12:00:00Z',
    });

    const res = await reservar(centro, centro.memberId);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-BOOK-403-005');
    // Rechaza ANTES de tomar el lugar: si no, la clase figuraría llena un rato.
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(0);
  });

  it('F1-11: con `allowDebt: true` el mismo socio sí reserva', async () => {
    const centro = await centroListo('deuda-permitida');
    await app.request(
      `/api/v1/venues/${centro.venueId}`,
      req(centro.cookie, 'PATCH', { bookingPolicy: { allowDebt: true } }),
    );
    await darPack(centro, centro.memberId, 8);
    await post(centro.cookie, '/api/v1/charges', {
      memberId: centro.memberId,
      venueId: centro.venueId,
      amountCents: 6_000_000,
      description: 'Cuota de marzo',
      dueAt: '2026-02-01T12:00:00Z',
    });

    expect((await reservar(centro, centro.memberId)).status).toBe(201);
  });

  it('F1-13: cancelar la clase libera las reservas y devuelve los créditos', async () => {
    const centro = await centroListo('deuda-clase');
    const contractId = await darPack(centro, centro.memberId, 8);
    await reservarOk(centro, centro.memberId);

    await post(centro.cookie, `/api/v1/sessions/${centro.sessionId}/cancel`, {
      reason: 'Se cortó la luz.',
    });

    // La clase no se dio: el crédito vuelve siempre, sin mirar la ventana.
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(0);
    const reservas = await mongoose.connection.db
      ?.collection('bookings')
      .find<{ status: string }>({ sessionId: centro.sessionId })
      .toArray();
    expect(reservas?.every((booking) => booking.status === 'cancelled')).toBe(true);
  });

  it('F1-09: congelar el contrato libera las reservas futuras y devuelve los créditos', async () => {
    const centro = await centroListo('deuda-freeze');
    const contractId = await darPack(centro, centro.memberId, 8);
    await reservarOk(centro, centro.memberId);
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(1);

    await post(centro.cookie, `/api/v1/contracts/${contractId}/freeze`, {
      days: 10,
      reason: 'Vacaciones.',
    });

    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(0);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(0);
  });
});

describe('el socio que reserva para sí mismo', () => {
  it('no dice para quién: la ficha sale de su sesión', async () => {
    const centro = await centroListo('atleta-propio');
    const atleta = await atletaDe(centro, 'propio');
    await darPack(centro, atleta.memberId, 8);

    const res = await app.request(
      '/api/v1/bookings',
      req(
        atleta.cookie,
        'POST',
        { sessionId: centro.sessionId },
        { 'Idempotency-Key': nuevaClave() },
      ),
    );

    expect(res.status).toBe(201);
    expect(((await res.json()) as BookingResult).booking.memberId).toBe(atleta.memberId);
  });

  it('reservar en nombre de otro es del mostrador, no del socio', async () => {
    const centro = await centroListo('atleta-ajeno');
    const atleta = await atletaDe(centro, 'ajeno');
    await darPack(centro, centro.memberId, 8);

    const res = await app.request(
      '/api/v1/bookings',
      req(
        atleta.cookie,
        'POST',
        { sessionId: centro.sessionId, memberId: centro.memberId },
        { 'Idempotency-Key': nuevaClave() },
      ),
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-002');
  });

  it('sin ficha en el centro no hay a quién reservarle', async () => {
    const centro = await centroListo('atleta-sin-ficha');
    const cookie = await usuarioSinFicha(centro, 'sin-ficha');

    const res = await app.request(
      '/api/v1/bookings',
      req(cookie, 'POST', { sessionId: centro.sessionId }, { 'Idempotency-Key': nuevaClave() }),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-404-003');
  });
});

describe('el listado de reservas', () => {
  it('trae las del socio, de la más nueva a la más vieja', async () => {
    const centro = await centroListo('listar');
    await darPack(centro, centro.memberId, 8);
    await reservarOk(centro, centro.memberId);
    const tarde = await otraClase(centro, '2026-03-03T22:00:00Z');
    ahora = Temporal.Instant.from('2026-03-02T13:00:00Z');
    await reservarEn(centro, tarde, centro.memberId);

    const res = await app.request(
      `/api/v1/bookings?memberId=${centro.memberId}`,
      req(centro.cookie, 'GET'),
    );

    const body = (await res.json()) as { items: Array<{ sessionId: string }> };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.sessionId).toBe(tarde);
  });

  it('pagina con `limit` y sigue por el cursor', async () => {
    const centro = await centroListo('paginar');
    await darPack(centro, centro.memberId, 8);
    await reservarOk(centro, centro.memberId);
    const tarde = await otraClase(centro, '2026-03-03T22:00:00Z');
    ahora = Temporal.Instant.from('2026-03-02T13:00:00Z');
    await reservarEn(centro, tarde, centro.memberId);

    const primera = await app.request(
      `/api/v1/bookings?memberId=${centro.memberId}&limit=1`,
      req(centro.cookie, 'GET'),
    );
    const pagina1 = (await primera.json()) as {
      items: Array<{ sessionId: string }>;
      nextCursor: string | null;
    };

    expect(pagina1.items).toHaveLength(1);
    expect(pagina1.nextCursor).not.toBeNull();

    const segunda = await app.request(
      `/api/v1/bookings?memberId=${centro.memberId}&limit=1&cursor=${encodeURIComponent(
        pagina1.nextCursor as string,
      )}`,
      req(centro.cookie, 'GET'),
    );
    const pagina2 = (await segunda.json()) as { items: Array<{ sessionId: string }> };

    // §5.0: paginación por cursor, nunca por `skip`. La segunda página no repite.
    expect(pagina2.items).toHaveLength(1);
    expect(pagina2.items[0]?.sessionId).not.toBe(pagina1.items[0]?.sessionId);
  });

  it('el socio ve las suyas sin tener que decir quién es', async () => {
    const centro = await centroListo('listar-propio');
    const atleta = await atletaDe(centro, 'listar-propio');
    await darPack(centro, atleta.memberId, 8);
    await reservarEn(centro, centro.sessionId, atleta.memberId);

    const res = await app.request('/api/v1/bookings', req(atleta.cookie, 'GET'));

    const body = (await res.json()) as { items: Array<{ memberId: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.memberId).toBe(atleta.memberId);
  });

  it('trae una reserva por su id', async () => {
    const centro = await centroListo('ver-una');
    await darPack(centro, centro.memberId, 8);
    const reserva = await reservarOk(centro, centro.memberId);

    const res = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}`,
      req(centro.cookie, 'GET'),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { publicId: string }).publicId).toBe(reserva.booking.publicId);
  });

  it('quien no tiene ficha ve una lista vacía, no un error', async () => {
    const centro = await centroListo('listar-sin-ficha');
    const cookie = await usuarioSinFicha(centro, 'listar-sin-ficha');

    const res = await app.request('/api/v1/bookings', req(cookie, 'GET'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });
});

describe('liberar las reservas de un contrato (F1-09)', () => {
  it('la clase que ya pasó no se libera: esa el socio la usó', async () => {
    const centro = await centroListo('congelar-pasada');
    const contractId = await darPack(centro, centro.memberId, 8);
    await reservarOk(centro, centro.memberId);

    // El lunes a la noche, con la clase del martes 10:00 ya dada.
    ahora = Temporal.Instant.from('2026-03-04T12:00:00Z');
    await post(centro.cookie, `/api/v1/contracts/${contractId}/freeze`, { days: 7 });

    // El crédito consumido sigue consumido, y el lugar sigue tomado.
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(1);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(1);
  });

  it('una clase borrada no rompe el congelamiento', async () => {
    const centro = await centroListo('congelar-huerfana');
    const contractId = await darPack(centro, centro.memberId, 8);
    await reservarOk(centro, centro.memberId);

    // Una reserva huérfana: la agenda ya no tiene la clase que la respalda.
    await mongoose.connection.db
      ?.collection('classSessions')
      .deleteOne({ publicId: centro.sessionId });

    const res = await app.request(
      `/api/v1/contracts/${contractId}/freeze`,
      req(centro.cookie, 'POST', { days: 7 }),
    );

    expect(res.status).toBe(200);
  });
});

describe('las ventanas de tiempo (§2.1.5.c)', () => {
  it('antes de que abra la reserva, no se puede', async () => {
    // La clase es el martes 3 a las 10:00 AR; con la apertura a 1 hora, el
    // lunes al mediodía todavía no abre.
    const centro = await centroListo('ventana-temprano', {
      bookingPolicy: { bookingOpensMinutesBefore: 60, bookingClosesMinutesBefore: 15 },
    });
    await darPack(centro, centro.memberId);

    const res = await reservar(centro, centro.memberId);

    expect(res.status).toBe(422);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-BOOK-422-003');
    expect(body.error.message).toContain('3 de marzo');
  });

  it('pasado el cierre, tampoco', async () => {
    const centro = await centroListo('ventana-tarde');
    await darPack(centro, centro.memberId);

    // La clase empieza 10:00 UTC y cierra 15 minutos antes.
    ahora = Temporal.Instant.from('2026-03-03T09:50:00Z');
    const res = await reservar(centro, centro.memberId);

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-422-003');
  });

  it('la categoría le pisa la ventana al centro', async () => {
    const centro = await centroListo('ventana-categoria', {
      bookingPolicy: {
        bookingOpensMinutesBefore: 60,
        bookingClosesMinutesBefore: 15,
        categoryPolicies: { funcional: { bookingOpensMinutesBefore: 10080 } },
      },
    });
    await darPack(centro, centro.memberId);

    // Con la ventana del centro estaría cerrada; la de la categoría abre 7 días
    // antes y es la que manda.
    const res = await reservar(centro, centro.memberId);

    expect(res.status).toBe(201);
  });
});

describe('la política que el socio ve antes de confirmar (§2.1.5.d)', () => {
  it('dice hasta cuándo puede cancelar, en la hora del centro', async () => {
    const centro = await centroListo('politica-texto');

    const res = await app.request(
      `/api/v1/booking-policies/${centro.sessionId}`,
      req(centro.cookie, 'GET'),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      text: string;
      lateCancelPolicy: string;
      canBookNow: boolean;
    };
    // La clase empieza 10:00 UTC (07:00 en Bahía Blanca) y el corte por default
    // son 2 horas: 05:00 de la mañana, en la hora del centro y no en UTC.
    expect(body.text).toContain('05:00');
    expect(body.text).toContain('no se te devuelve');
    expect(body.lateCancelPolicy).toBe('no_refund');
    expect(body.canBookNow).toBe(true);
  });

  it('una clase que no existe no tiene política', async () => {
    const centro = await centroListo('politica-inexistente');

    const res = await app.request(
      '/api/v1/booking-policies/ses_no_existe',
      req(centro.cookie, 'GET'),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-404-006');
  });
});

describe('late cancel (§2.1.9)', () => {
  it('avisa antes de dejar que el socio pierda el crédito', async () => {
    const centro = await centroListo('late-aviso');
    const contractId = await darPack(centro, centro.memberId);
    const reserva = await reservarOk(centro, centro.memberId);

    // Media hora antes de la clase, con el corte en 2 horas.
    ahora = Temporal.Instant.from('2026-03-03T09:30:00Z');
    const res = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-422-004');
    // Nada se movió: el socio todavía no dijo que sí.
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(1);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(1);
  });

  it('confirmado, cancela igual: pierde el crédito pero libera el lugar', async () => {
    const centro = await centroListo('late-confirmado');
    const contractId = await darPack(centro, centro.memberId);
    const reserva = await reservarOk(centro, centro.memberId);

    ahora = Temporal.Instant.from('2026-03-03T09:30:00Z');
    const res = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', { acceptsLateCancel: true }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('late_cancelled');
    // El crédito no vuelve (§2.1.9), el lugar sí: otro lo puede tomar.
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(1);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(0);
  });

  it('con la política `refund` del centro, el crédito vuelve igual', async () => {
    const centro = await centroListo('late-generoso', {
      bookingPolicy: { lateCancelPolicy: 'refund' },
    });
    const contractId = await darPack(centro, centro.memberId);
    const reserva = await reservarOk(centro, centro.memberId);

    ahora = Temporal.Instant.from('2026-03-03T09:30:00Z');
    await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', { acceptsLateCancel: true }),
    );

    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(0);
  });

  it('dentro del plazo no pide confirmación y devuelve el crédito', async () => {
    const centro = await centroListo('late-en-plazo');
    const contractId = await darPack(centro, centro.memberId);
    const reserva = await reservarOk(centro, centro.memberId);

    // Tres horas antes, con el corte en dos.
    ahora = Temporal.Instant.from('2026-03-03T07:00:00Z');
    const res = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('cancelled');
    expect((await contratoEnBase(contractId))?.creditsUsed).toBe(0);
  });

  it('salir de la lista de espera nunca es tarde: nunca tuvo lugar', async () => {
    const centro = await centroListo('late-espera', { capacity: 1 });
    const primero = await socioCon(centro, 'Primero', 8);
    const segundo = await socioCon(centro, 'Segundo', 8);
    await reservarOk(centro, primero);
    const enEspera = await reservarOk(centro, segundo);

    ahora = Temporal.Instant.from('2026-03-03T09:30:00Z');
    const res = await app.request(
      `/api/v1/bookings/${enEspera.booking.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('cancelled');
  });
});

describe('lista de espera: promoción automática (§2.1.5.b)', () => {
  /** Una clase de un solo lugar, ocupado, con dos personas esperando en orden. */
  async function filaDeDos(nombre: string, policy: Record<string, unknown> = {}) {
    const centro = await centroListo(nombre, { capacity: 1, bookingPolicy: policy });
    const conLugar = await socioCon(centro, 'ConLugar', 8);
    const primero = await socioCon(centro, 'Primero', 8);
    const segundo = await socioCon(centro, 'Segundo', 8);

    const reserva = await reservarOk(centro, conLugar);
    const espera1 = await reservarOk(centro, primero);
    const espera2 = await reservarOk(centro, segundo);

    return { centro, conLugar, primero, segundo, reserva, espera1, espera2 };
  }

  const reservaEnBase = async (bookingId: string) =>
    mongoose.connection.db
      ?.collection('bookings')
      .findOne<{ status: string; waitlistPosition: number | null; holdExpiresAt: Date | null }>({
        publicId: bookingId,
      });

  const cancelar = (centro: Centro, bookingId: string, body: unknown = {}) =>
    app.request(`/api/v1/bookings/${bookingId}/cancel`, req(centro.cookie, 'POST', body));

  it('la fila es FIFO: las posiciones salen en orden de llegada', async () => {
    const { espera1, espera2 } = await filaDeDos('fila-fifo');

    expect(espera1.booking.waitlistPosition).toBe(1);
    expect(espera2.booking.waitlistPosition).toBe(2);
  });

  it('una cancelación promueve al primero y le guarda el lugar', async () => {
    const { centro, reserva, espera1 } = await filaDeDos('fila-promueve');

    await cancelar(centro, reserva.booking.publicId);
    const promovido = await reservaEnBase(espera1.booking.publicId);

    // Sigue en `waitlisted` porque todavía no confirmó, pero el lugar ya es suyo.
    expect(promovido?.status).toBe('waitlisted');
    expect(promovido?.holdExpiresAt).not.toBeNull();
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(1);
  });

  it('el segundo de la fila sube a la posición 1', async () => {
    const { centro, reserva, espera2 } = await filaDeDos('fila-corrimiento');

    await cancelar(centro, reserva.booking.publicId);

    expect((await reservaEnBase(espera2.booking.publicId))?.waitlistPosition).toBe(1);
  });

  it('confirmar descuenta el crédito, igual que una reserva normal', async () => {
    const { centro, reserva, espera1, primero } = await filaDeDos('fila-confirma');
    const contrato = await contratoDe(primero);
    await cancelar(centro, reserva.booking.publicId);

    const res = await app.request(
      `/api/v1/bookings/${espera1.booking.publicId}/confirm`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as BookingResult;
    expect(cuerpo.booking.status).toBe('booked');
    // Mientras esperaba no tenía nada que consumir: el crédito sale ahora.
    expect((await contratoEnBase(contrato))?.creditsUsed).toBe(1);
  });

  it('vencida la ventana, ya no se confirma', async () => {
    const { centro, reserva, espera1 } = await filaDeDos('fila-vencida');
    await cancelar(centro, reserva.booking.publicId);

    // La ventana por default son 15 minutos.
    ahora = ahora.add({ minutes: 16 });
    const res = await app.request(
      `/api/v1/bookings/${espera1.booking.publicId}/confirm`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-422-009');
  });

  it('🔴 el que no confirma pierde el lugar y pasa al siguiente', async () => {
    const { centro, reserva, espera1, espera2 } = await filaDeDos('fila-expira');
    await cancelar(centro, reserva.booking.publicId);

    ahora = ahora.add({ minutes: 16 });
    await correrJob('expireWaitlistHolds');

    // Juan no contestó: pierde el lugar y lo hereda Lucía, sin que nadie del
    // staff toque nada (§2.1.5.b).
    expect((await reservaEnBase(espera1.booking.publicId))?.status).toBe('cancelled');
    const segundo = await reservaEnBase(espera2.booking.publicId);
    expect(segundo?.status).toBe('waitlisted');
    expect(segundo?.holdExpiresAt).not.toBeNull();
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(1);
  });

  it('avisa por evento a quién promovió y hasta cuándo tiene', async () => {
    const vistos: Array<{ memberId: string; confirmBefore: string }> = [];
    bus.on('booking.waitlist_promoted', (payload) => {
      vistos.push({ memberId: payload.memberId, confirmBefore: payload.confirmBefore });
    });
    const { centro, reserva, primero } = await filaDeDos('fila-evento');

    await cancelar(centro, reserva.booking.publicId);

    // De este evento cuelga el aviso de F1-22: sin él, el promovido nunca se
    // entera de que tiene 15 minutos.
    expect(vistos).toHaveLength(1);
    expect(vistos[0]?.memberId).toBe(primero);
    expect(vistos[0]?.confirmBefore).toBe(ahora.add({ minutes: 15 }).toString());
  });

  it('pasado el corte de promoción, el lugar queda libre y no se avisa a nadie', async () => {
    const { centro, reserva, espera1 } = await filaDeDos('fila-corte');

    // A 20 minutos del inicio, con el corte en 30: avisar ahora es mandar a
    // alguien a llegar tarde.
    ahora = Temporal.Instant.from('2026-03-03T09:40:00Z');
    await cancelar(centro, reserva.booking.publicId, { acceptsLateCancel: true });

    expect((await reservaEnBase(espera1.booking.publicId))?.holdExpiresAt ?? null).toBeNull();
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(0);
  });

  it('🔴 dos cancelaciones simultáneas no promueven a la misma persona dos veces', async () => {
    const centro = await centroListo('fila-concurrente', {
      capacity: 2,
      bookingPolicy: { waitlistMaxSize: 10 },
    });
    const conLugar1 = await socioCon(centro, 'Lugar1', 8);
    const conLugar2 = await socioCon(centro, 'Lugar2', 8);
    const primero = await socioCon(centro, 'Espera1', 8);
    const segundo = await socioCon(centro, 'Espera2', 8);
    const uno = await reservarOk(centro, conLugar1);
    const dos = await reservarOk(centro, conLugar2);
    const espera1 = await reservarOk(centro, primero);
    const espera2 = await reservarOk(centro, segundo);

    await Promise.all([
      cancelar(centro, uno.booking.publicId),
      cancelar(centro, dos.booking.publicId),
    ]);

    // Cada lugar liberado tiene que ir a una persona distinta: el `claimSeat`
    // atómico es lo que impide que las dos cancelaciones le den el suyo al
    // primero de la fila.
    const promovidos = await mongoose.connection.db
      ?.collection('bookings')
      .find({ publicId: { $in: [espera1.booking.publicId, espera2.booking.publicId] } })
      .toArray();
    const conHold = promovidos?.filter((b) => b['holdExpiresAt'] !== null);

    expect(conHold).toHaveLength(2);
    expect((await claseEnBase(centro.sessionId))?.bookedCount).toBe(2);
  });

  it('el job corre cada minuto: la ventana se mide en minutos', () => {
    const job = modules.jobs.find((candidate) => candidate.name === 'expireWaitlistHolds');

    // Con un job cada cinco minutos, el que confirmó a horario podría
    // encontrarse con que ya se lo pasaron al siguiente.
    expect(job?.cron).toBe('* * * * *');
  });

  it('la lista tiene tope: llena, responde LP-BOOK-422-008', async () => {
    const centro = await centroListo('fila-llena', {
      capacity: 1,
      bookingPolicy: { waitlistMaxSize: 1 },
    });
    const conLugar = await socioCon(centro, 'Lugar', 8);
    const enFila = await socioCon(centro, 'Fila', 8);
    const tarde = await socioCon(centro, 'Tarde', 8);
    await reservarOk(centro, conLugar);
    await reservarOk(centro, enFila);

    const res = await reservar(centro, tarde);

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-422-008');
  });

  it('anotarse dos veces en la misma fila responde LP-BOOK-409-007', async () => {
    const { centro, primero } = await filaDeDos('fila-doble');

    const res = await reservar(centro, primero);

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BOOK-409-007');
  });

  it('salir de la fila corrige las posiciones de los que quedan', async () => {
    const { centro, espera1, espera2 } = await filaDeDos('fila-baja');

    await cancelar(centro, espera1.booking.publicId);

    expect((await reservaEnBase(espera2.booking.publicId))?.waitlistPosition).toBe(1);
    expect((await claseEnBase(centro.sessionId))?.waitlistCount).toBe(1);
  });

  it('la baja del socio también lo saca de las filas', async () => {
    const { centro, primero, espera1 } = await filaDeDos('fila-baja-socio');

    await post(centro.cookie, `/api/v1/members/${primero}/archive`, {});

    // Va por evento: Members no puede tocar el modelo de Booking (ADR-003).
    expect((await reservaEnBase(espera1.booking.publicId))?.status).toBe('cancelled');
    expect((await claseEnBase(centro.sessionId))?.waitlistCount).toBe(1);
  });

  it('congelar el contrato saca al socio de todas las filas', async () => {
    const { centro, primero, espera1 } = await filaDeDos('fila-freeze');
    const contrato = await contratoDe(primero);

    await post(centro.cookie, `/api/v1/contracts/${contrato}/freeze`, { days: 7 });

    // Guardarle el lugar a alguien que decidió no venir en un mes deja la fila
    // trabada para el resto (§2.1.5.b).
    expect((await reservaEnBase(espera1.booking.publicId))?.status).toBe('cancelled');
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve ni cancela la reserva del otro centro', async () => {
    const victima = await centroListo('bkg-victima');
    await darPack(victima, victima.memberId);
    const reserva = await reservarOk(victima, victima.memberId);
    const atacante = await centroListo('bkg-atacante');

    const ver = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}`,
      req(atacante.cookie, 'GET'),
    );
    const cancelar = await app.request(
      `/api/v1/bookings/${reserva.booking.publicId}/cancel`,
      req(atacante.cookie, 'POST', {}),
    );

    expect(ver.status).toBe(404);
    expect(cancelar.status).toBe(404);
  });

  it('no se puede reservar una clase de otro centro', async () => {
    const victima = await centroListo('bkg-clase-victima');
    const atacante = await centroListo('bkg-clase-atacante');
    await darPack(atacante, atacante.memberId);

    const res = await app.request(
      '/api/v1/bookings',
      req(
        atacante.cookie,
        'POST',
        { sessionId: victima.sessionId, memberId: atacante.memberId },
        { 'Idempotency-Key': nuevaClave() },
      ),
    );

    expect(res.status).toBe(404);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las seis rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter(
      (route) =>
        route.path.startsWith('/api/v1/bookings') ||
        route.path.startsWith('/api/v1/booking-policies'),
    );

    expect(rutas).toHaveLength(6);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('bkg-fixtures');
    const victima = await nuevoCentro('bkg-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      const propia =
        route.path.startsWith('/api/v1/bookings') ||
        route.path.startsWith('/api/v1/booking-policies');
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
