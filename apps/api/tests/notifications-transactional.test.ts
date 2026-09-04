import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import type { OutgoingEmail } from '../src/modules/notifications/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-22. Los avisos automáticos de §2.1.14.
 *
 * Cada uno se prueba desde el flujo que lo dispara, no llamando al motor: lo
 * que hay que verificar es justamente que **nadie llama a Notifications** y que
 * el aviso sale igual. Y que sale **una sola vez** por hito, que es la
 * diferencia entre un recordatorio y un acoso.
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

let ahora = Temporal.Instant.from('2026-03-02T12:00:00Z');

const buzon: OutgoingEmail[] = [];
const mailer = {
  send(email: OutgoingEmail) {
    buzon.push(email);

    return Promise.resolve();
  },
};

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

/** Un centro con sede, sala y una clase con cupo. */
async function centroListo(nombre: string, opciones: { capacity?: number; startAt?: string } = {}) {
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

  const clase = await post<{ publicId: string }>(centro.cookie, '/api/v1/sessions', {
    venueId: sede.publicId,
    roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    // 22:00 UTC del 3 = 19:00 del 3 en Buenos Aires.
    startAt: opciones.startAt ?? '2026-03-03T22:00:00Z',
    durationMin: 60,
    capacity: opciones.capacity ?? 16,
  });

  return { ...centro, venueId: sede.publicId, roomId, sessionId: clase.publicId };
}

type Centro = Awaited<ReturnType<typeof centroListo>>;

/** Un socio con cuenta propia: es el único que puede recibir un aviso. */
async function atletaDe(centro: Centro, nombre: string) {
  const codigo = await post<{ code: string }>(centro.cookie, '/api/v1/invite-codes', {
    venueId: centro.venueId,
    maxUses: 5,
    expiresAt: '2026-12-31T00:00:00Z',
  });

  const email = `${nombre}-${++creados}@laplace.test`;
  const cookie = await signUp(email);
  const canje = await post<{ memberId: string; organizationId: string }>(
    cookie,
    '/api/v1/invite-codes/redeem',
    { code: codigo.code, firstName: nombre, lastName: 'Socio' },
  );

  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: canje.organizationId }),
  );
  await app.request(`/api/v1/members/${canje.memberId}`, req(centro.cookie, 'PATCH', { email }));

  return { cookie, memberId: canje.memberId, email };
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

/** Un socio del centro con cuenta y pack, listo para reservar. */
async function socioListo(centro: Centro, nombre: string, durationDays = 30) {
  const atleta = await atletaDe(centro, nombre);
  const contractId = await darPack(centro, atleta.memberId, durationDays);

  return { ...atleta, contractId };
}

let clave = 0;
async function reservar(centro: Centro, memberId: string) {
  const res = await app.request(
    '/api/v1/bookings',
    req(
      centro.cookie,
      'POST',
      { sessionId: centro.sessionId, memberId },
      { 'Idempotency-Key': `ntf22-${++clave}-${Date.now()}` },
    ),
  );
  if (res.status !== 201) throw new Error(`reserva falló: ${res.status} ${await res.text()}`);

  const { booking } = (await res.json()) as { booking: { publicId: string; status: string } };

  return booking;
}

/** Cancelar una reserva. El plazo se acepta explícitamente (§2.1.9). */
const cancelar = (centro: Centro, bookingId: string) =>
  app.request(
    `/api/v1/bookings/${bookingId}/cancel`,
    req(centro.cookie, 'POST', { acceptsLateCancel: true }),
  );

const correrJob = async (name: string) => {
  const job = modules.jobs.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`no existe el job ${name}`);

  await job.handler();
};

interface AvisoEnBase {
  publicId: string;
  userId: string;
  channel: string;
  eventType: string;
  subject: string;
  body: string;
  subjectId: string;
}

const avisosEnBase = async (filtro: Record<string, unknown> = {}) =>
  (await mongoose.connection.db
    ?.collection('notifications')
    .find<AvisoEnBase>({ channel: 'in_app', ...filtro })
    .toArray()) ?? [];

/** Los avisos de un tipo, que es lo que cada test mira. */
const avisosDe = (eventType: string) => avisosEnBase({ eventType });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_notifications_tx_test' });
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
    mailer,
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
  buzon.length = 0;
  entitlements.invalidateAll();
  for (const coleccion of [
    'notifications',
    'notificationTemplates',
    'notificationPreferences',
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

describe('los avisos de reserva', () => {
  it('cancelar avisa, con la clase y la hora', async () => {
    const centro = await centroListo('cancelar');
    const socio = await socioListo(centro, 'Micaela');
    const reserva = await reservar(centro, socio.memberId);

    await cancelar(centro, reserva.publicId);

    const [aviso] = await avisosDe('booking.cancelled');
    expect(aviso?.body).toContain('Micaela');
    expect(aviso?.body).toContain('Funcional');
    expect(aviso?.body).toContain('19:00');
  });

  it('🔴 la promoción desde la lista de espera avisa con el plazo de confirmación', async () => {
    const centro = await centroListo('waitlist', { capacity: 1 });
    const primero = await socioListo(centro, 'Primero');
    const segundo = await socioListo(centro, 'Segundo');
    const reserva = await reservar(centro, primero.memberId);
    const espera = await reservar(centro, segundo.memberId);

    expect(espera.status).toBe('waitlisted');
    await cancelar(centro, reserva.publicId);

    const [aviso] = await avisosDe('booking.waitlist_promoted');
    expect(aviso?.body).toContain('Segundo');
    expect(aviso?.body).toContain('Confirmá antes de las');
  });
});

describe('los avisos de clase', () => {
  it('🔴 cancelar la clase avisa a todos los inscriptos, con el motivo', async () => {
    const centro = await centroListo('clase-cancelada', { capacity: 1 });
    const anotado = await socioListo(centro, 'Anotado');
    const enEspera = await socioListo(centro, 'EnEspera');
    await reservar(centro, anotado.memberId);
    await reservar(centro, enEspera.memberId);

    await post(centro.cookie, `/api/v1/sessions/${centro.sessionId}/cancel`, {
      reason: 'corte de luz',
    });

    const avisos = await avisosDe('session.cancelled');
    // También al de la lista de espera: organizó su tarde alrededor de esa clase.
    expect(avisos).toHaveLength(2);
    expect(avisos[0]?.body).toContain('corte de luz');
  });

  it('el cambio de coach avisa solo a los que tienen lugar', async () => {
    const centro = await centroListo('coach', { capacity: 1 });
    const anotado = await socioListo(centro, 'Anotado');
    const enEspera = await socioListo(centro, 'EnEspera');
    await reservar(centro, anotado.memberId);
    await reservar(centro, enEspera.memberId);

    await app.request(
      `/api/v1/sessions/${centro.sessionId}`,
      req(centro.cookie, 'PATCH', { coachId: 'usr_coach_nuevo' }),
    );

    const avisos = await avisosDe('session.coach_changed');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.body).toContain('Anotado');
  });
});

describe('los recordatorios de clase (§2.1.14)', () => {
  it('🔴 a 24 horas sale el de "mañana tenés"', async () => {
    const centro = await centroListo('recordatorio-24');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    // La clase arranca 2026-03-03T22:00Z: 23 horas después de este instante.
    ahora = Temporal.Instant.from('2026-03-02T23:00:00Z');
    await correrJob('classReminders');

    const [aviso] = await avisosDe('session.reminder_24h');
    expect(aviso?.body).toContain('Micaela');
    expect(aviso?.body).toContain('Funcional');
    expect(await avisosDe('session.reminder_1h')).toHaveLength(0);
  });

  it('🔴 dentro de la última hora sale el de "en 1 hora", y no el otro', async () => {
    const centro = await centroListo('recordatorio-1');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    ahora = Temporal.Instant.from('2026-03-03T21:30:00Z');
    await correrJob('classReminders');

    expect(await avisosDe('session.reminder_1h')).toHaveLength(1);
    expect(await avisosDe('session.reminder_24h')).toHaveLength(0);
  });

  it('🔴 correr el job cuatro veces manda un solo recordatorio por hito', async () => {
    const centro = await centroListo('recordatorio-idempotente');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    ahora = Temporal.Instant.from('2026-03-02T23:00:00Z');
    await correrJob('classReminders');
    await correrJob('classReminders');

    ahora = Temporal.Instant.from('2026-03-03T21:30:00Z');
    await correrJob('classReminders');
    await correrJob('classReminders');

    expect(await avisosDe('session.reminder_24h')).toHaveLength(1);
    expect(await avisosDe('session.reminder_1h')).toHaveLength(1);
  });

  it('al de la lista de espera no se le recuerda un lugar que no tiene', async () => {
    const centro = await centroListo('recordatorio-espera', { capacity: 1 });
    const anotado = await socioListo(centro, 'Anotado');
    const enEspera = await socioListo(centro, 'EnEspera');
    await reservar(centro, anotado.memberId);
    await reservar(centro, enEspera.memberId);

    ahora = Temporal.Instant.from('2026-03-02T23:00:00Z');
    await correrJob('classReminders');

    expect(await avisosDe('session.reminder_24h')).toHaveLength(1);
  });

  it('la clase cancelada no recuerda nada', async () => {
    const centro = await centroListo('recordatorio-cancelada');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);
    await post(centro.cookie, `/api/v1/sessions/${centro.sessionId}/cancel`, { reason: 'lluvia' });

    ahora = Temporal.Instant.from('2026-03-02T23:00:00Z');
    await correrJob('classReminders');

    expect(await avisosDe('session.reminder_24h')).toHaveLength(0);
  });
});

describe('los avisos del pack', () => {
  it('🔴 el pack por vencer avisa con los días que faltan y la fecha', async () => {
    const centro = await centroListo('pack-vence');
    await socioListo(centro, 'Micaela', 10);

    // El pack vence 10 días después de la venta: a los 3 días de distancia cae
    // el hito de 7 (§2.1.2).
    ahora = Temporal.Instant.from('2026-03-05T12:00:00Z');
    await correrJob('notifyExpiringContracts');

    const [aviso] = await avisosDe('contract.expiring');
    expect(aviso?.body).toContain('Pack 8 clases');
    expect(aviso?.subject).toContain('7');
  });

  it('correr el job de nuevo el mismo día no repite el aviso', async () => {
    const centro = await centroListo('pack-vence-dos');
    await socioListo(centro, 'Micaela', 10);

    ahora = Temporal.Instant.from('2026-03-05T12:00:00Z');
    await correrJob('notifyExpiringContracts');
    await correrJob('notifyExpiringContracts');

    expect(await avisosDe('contract.expiring')).toHaveLength(1);
  });

  it('cada hito es un aviso distinto, no una repetición', async () => {
    const centro = await centroListo('pack-hitos');
    await socioListo(centro, 'Micaela', 10);

    ahora = Temporal.Instant.from('2026-03-05T12:00:00Z');
    await correrJob('notifyExpiringContracts');
    // 3 días antes del vencimiento: el hito de 3.
    ahora = Temporal.Instant.from('2026-03-09T12:00:00Z');
    await correrJob('notifyExpiringContracts');

    const avisos = await avisosDe('contract.expiring');
    expect(avisos).toHaveLength(2);
    expect(new Set(avisos.map((aviso) => aviso.subjectId)).size).toBe(2);
  });

  it('🔴 el pack vencido avisa, con el nombre del pack', async () => {
    const centro = await centroListo('pack-vencido');
    await socioListo(centro, 'Micaela', 10);

    ahora = Temporal.Instant.from('2026-03-13T12:00:00Z');
    await correrJob('expireContracts');

    const [aviso] = await avisosDe('contract.expired');
    expect(aviso?.body).toContain('Micaela');
    expect(aviso?.body).toContain('Pack 8 clases');
  });
});

describe('los avisos de plata (§2.1.12)', () => {
  it('🔴 la deuda vencida avisa con el total y desde cuándo', async () => {
    const centro = await centroListo('mora');
    const socio = await atletaDe(centro, 'Micaela');
    await post(centro.cookie, '/api/v1/charges', {
      memberId: socio.memberId,
      venueId: centro.venueId,
      amountCents: 1_800_000,
      dueAt: '2026-03-01T12:00:00Z',
      description: 'Cuota de marzo',
    });

    await correrJob('dunning');

    const [aviso] = await avisosDe('charge.overdue');
    expect(aviso?.body).toContain('$18.000');
    expect(aviso?.body).toContain('domingo 1 de marzo');
  });

  it('🔴 el aviso de mora sale aunque el socio haya apagado el mail', async () => {
    const centro = await centroListo('mora-optout');
    const socio = await atletaDe(centro, 'Micaela');
    await app.request(
      '/api/v1/notification-preferences',
      req(socio.cookie, 'PUT', {
        preferences: [{ eventType: 'charge.overdue', channel: 'email', enabled: false }],
      }),
    );
    await post(centro.cookie, '/api/v1/charges', {
      memberId: socio.memberId,
      venueId: centro.venueId,
      amountCents: 500_000,
      dueAt: '2026-03-01T12:00:00Z',
      description: 'Cuota de marzo',
    });

    await correrJob('dunning');

    const porMail = await avisosEnBase({ channel: 'email', eventType: 'charge.overdue' });
    expect(porMail).toHaveLength(1);
  });

  it('el pago recibido avisa con el monto y la fecha', async () => {
    const centro = await centroListo('pago');
    const socio = await atletaDe(centro, 'Micaela');

    const pago = await app.request(
      '/api/v1/payments',
      req(
        centro.cookie,
        'POST',
        {
          memberId: socio.memberId,
          venueId: centro.venueId,
          amountCents: 1_800_000,
          method: 'cash',
        },
        { 'Idempotency-Key': `pago-${Date.now()}` },
      ),
    );
    expect(pago.status).toBe(201);

    const [aviso] = await avisosDe('payment.received');
    expect(aviso?.body).toContain('$18.000');
    expect(aviso?.body).toContain('lunes 2 de marzo');
  });
});

describe('todos respetan lo de F1-21', () => {
  it('el opt-out apaga el aviso que no es de plata', async () => {
    const centro = await centroListo('opt-out-tx');
    const socio = await socioListo(centro, 'Micaela');
    await app.request(
      '/api/v1/notification-preferences',
      req(socio.cookie, 'PUT', {
        preferences: [
          { eventType: 'session.reminder_24h', channel: 'in_app', enabled: false },
          { eventType: 'session.reminder_24h', channel: 'email', enabled: false },
        ],
      }),
    );
    await reservar(centro, socio.memberId);

    ahora = Temporal.Instant.from('2026-03-02T23:00:00Z');
    await correrJob('classReminders');

    expect(await avisosEnBase({ eventType: 'session.reminder_24h' })).toHaveLength(0);
  });

  it('🔴 el recordatorio de una clase de la mañana no sale de madrugada', async () => {
    // Clase a las 08:00 de Buenos Aires del 4 = 11:00 UTC.
    const centro = await centroListo('madrugada-tx', { startAt: '2026-03-04T11:00:00Z' });
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    // 24 horas antes son las 08:00 del 3... pero probamos el borde: el job corre
    // a las 03:00 locales del 4 (06:00 UTC), dentro de la ventana de silencio.
    ahora = Temporal.Instant.from('2026-03-04T06:00:00Z');
    await correrJob('classReminders');

    const porMail = await mongoose.connection.db
      ?.collection('notifications')
      .findOne<{ nextAttemptAt: Date }>({
        channel: 'email',
        eventType: 'session.reminder_24h',
      });

    // Se difiere hasta las 08:00 locales, que es 11:00 UTC.
    expect(porMail?.nextAttemptAt.toISOString()).toBe('2026-03-04T11:00:00.000Z');
  });
});
