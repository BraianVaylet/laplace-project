import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type {
  DeliveryLogEntry,
  Notification,
  NotificationPreference,
  NotificationTemplate,
} from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import type { OutgoingEmail } from '../src/modules/notifications/index.js';
import { VICTIM_NOTIFICATION_SUBJECT } from '../src/modules/notifications/infrastructure/routes.js';
import { runWithTenant } from '../src/tenancy/context.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-21. El motor de avisos de §2.1.14.
 *
 * Lo que se verifica y no se negocia: que **un fallo de envío nunca rompa el
 * flujo que lo originó**, que el backoff sea el declarado, que el mismo aviso
 * no salga dos veces, y que el opt-out se respete salvo en los avisos de plata.
 *
 * Ningún test manda un mail: el proveedor se inyecta como puerto.
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

/** El proveedor de mail de mentira: cuenta lo que sale y falla cuando se le pide. */
const buzon: OutgoingEmail[] = [];
let fallosPendientes = 0;
const mailer = {
  send(email: OutgoingEmail) {
    if (fallosPendientes > 0) {
      fallosPendientes -= 1;

      return Promise.reject(new Error('el proveedor de mail está caído'));
    }

    buzon.push(email);

    return Promise.resolve();
  },
};

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

async function post<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

/** Un centro con sede, sala y una clase con cupo: el escenario mínimo para reservar. */
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

  const clase = await post<{ publicId: string }>(centro.cookie, '/api/v1/sessions', {
    venueId: sede.publicId,
    roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    // 10:00 UTC del 3 de marzo = 07:00 en Buenos Aires.
    startAt: '2026-03-03T22:00:00Z',
    durationMin: 60,
    capacity: 16,
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

  // El canje no pide mail: se lo carga el centro, que es de donde sale el envío.
  await app.request(`/api/v1/members/${canje.memberId}`, req(centro.cookie, 'PATCH', { email }));

  return { cookie, memberId: canje.memberId, email };
}

/** Le vende un pack al socio y lo activa, para que pueda reservar. */
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
}

let clave = 0;
const reservar = (centro: Centro, memberId: string) =>
  app.request(
    '/api/v1/bookings',
    req(
      centro.cookie,
      'POST',
      { sessionId: centro.sessionId, memberId },
      { 'Idempotency-Key': `ntf-${++clave}-${Date.now()}` },
    ),
  );

/** Un socio del centro, con pack, listo para reservar. */
async function socioListo(centro: Centro, nombre: string) {
  const atleta = await atletaDe(centro, nombre);
  await darPack(centro, atleta.memberId);

  return atleta;
}

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
  status: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date | null;
  readAt: Date | null;
}

const avisosEnBase = async (filtro: Record<string, unknown> = {}) =>
  (await mongoose.connection.db
    ?.collection('notifications')
    .find<AvisoEnBase>(filtro)
    .sort({ channel: 1 })
    .toArray()) ?? [];

/** Encola un aviso a mano, sin pasar por el flujo que normalmente lo origina. */
const encolar = (
  organizationId: string,
  request: Parameters<typeof modules.notifications.service.queue>[0],
) =>
  runWithTenant({ tenantId: organizationId, userId: 'usr_test', requestId: 'req-test' }, () =>
    modules.notifications.service.queue(request),
  );

const AR = 'America/Argentina/Buenos_Aires';

const avisoDeReserva = (userId: string) => ({
  eventType: 'booking.created' as const,
  userId,
  email: 'micaela@laplace.test',
  subjectId: 'bkg_1',
  timeZone: AR,
  values: {
    nombre: 'Micaela',
    clase: 'Funcional',
    fecha: 'martes 3 de marzo',
    hora: '19:00',
    sede: 'Box Toro Centro',
  },
});

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_notifications_test' });
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
  fallosPendientes = 0;
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
    'rooms',
    'venues',
  ]) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('la confirmación de reserva (§2.1.14)', () => {
  it('🔴 reservar encola el aviso sin que Booking sepa que Notifications existe', async () => {
    const centro = await centroListo('confirmacion');
    const socio = await socioListo(centro, 'Micaela');

    const res = await reservar(centro, socio.memberId);

    expect(res.status).toBe(201);
    const avisos = await avisosEnBase();
    expect(avisos.map((aviso) => aviso.channel)).toEqual(['email', 'in_app']);
    expect(avisos[0]?.eventType).toBe('booking.created');
  });

  it('el texto sale resuelto, con la clase y la hora del centro', async () => {
    const centro = await centroListo('texto');
    const socio = await socioListo(centro, 'Micaela');

    await reservar(centro, socio.memberId);

    const [aviso] = await avisosEnBase({ channel: 'in_app' });
    // La clase arranca 22:00 UTC del 3, o sea las 19:00 del 3 en Buenos Aires.
    expect(aviso?.body).toContain('Micaela');
    expect(aviso?.body).toContain('Funcional');
    expect(aviso?.body).toContain('19:00');
    expect(aviso?.body).not.toContain('{{');
  });

  it('un socio sin cuenta no recibe nada, y eso no rompe la reserva', async () => {
    const centro = await centroListo('sin-cuenta');
    const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
      firstName: 'Walk',
      lastName: 'In',
      venueIds: [centro.venueId],
    });
    await darPack(centro, socio.publicId);

    const res = await reservar(centro, socio.publicId);

    expect(res.status).toBe(201);
    expect(await avisosEnBase()).toHaveLength(0);
  });

  it('🔴 el proveedor caído no rompe la reserva: solo demora el aviso', async () => {
    const centro = await centroListo('proveedor-caido');
    const socio = await socioListo(centro, 'Micaela');
    fallosPendientes = 99;

    const res = await reservar(centro, socio.memberId);
    await correrJob('dispatchNotifications');

    expect(res.status).toBe(201);
    const [email] = await avisosEnBase({ channel: 'email' });
    expect(email?.status).toBe('queued');
    expect(email?.lastError).toContain('caído');
  });
});

describe('la cola: backoff, un solo envío y cola de fallidos', () => {
  async function conAvisoEncolado(nombre: string) {
    const centro = await centroListo(nombre);
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    return { centro, socio };
  }

  it('el aviso sale y queda registrado como enviado', async () => {
    await conAvisoEncolado('envio-ok');

    await correrJob('dispatchNotifications');

    const [email] = await avisosEnBase({ channel: 'email' });
    expect(email?.status).toBe('sent');
    expect(buzon).toHaveLength(1);
    expect(buzon[0]?.subject).toContain('Funcional');
  });

  it('🔴 el backoff es 30 s, 2 min y 10 min (§2.1.14)', async () => {
    await conAvisoEncolado('backoff');
    fallosPendientes = 3;

    const esperas: Array<string | undefined> = [];
    for (const salto of [0, 30, 120]) {
      ahora = ahora.add({ seconds: salto });
      await correrJob('dispatchNotifications');
      const [email] = await avisosEnBase({ channel: 'email' });
      esperas.push(email?.nextAttemptAt?.toISOString());
    }

    expect(esperas).toEqual([
      '2026-03-02T12:00:30.000Z',
      '2026-03-02T12:02:30.000Z',
      '2026-03-02T12:12:30.000Z',
    ]);
  });

  it('antes de que venza la espera no se vuelve a intentar', async () => {
    await conAvisoEncolado('espera');
    fallosPendientes = 1;

    await correrJob('dispatchNotifications');
    ahora = ahora.add({ seconds: 10 });
    await correrJob('dispatchNotifications');

    const [email] = await avisosEnBase({ channel: 'email' });
    expect(email?.attempts).toBe(1);
    expect(email?.status).toBe('queued');
  });

  it('🔴 agotados los tres reintentos, queda fallido y visible para soporte', async () => {
    await conAvisoEncolado('agotado');
    fallosPendientes = 99;

    for (const salto of [0, 30, 120, 600]) {
      ahora = ahora.add({ seconds: salto });
      await correrJob('dispatchNotifications');
    }

    const [email] = await avisosEnBase({ channel: 'email' });
    expect(email?.status).toBe('failed');
    // El primer envio mas los tres reintentos de §2.1.14.
    expect(email?.attempts).toBe(4);
    expect(email?.nextAttemptAt).toBeNull();
    expect(email?.lastError).toContain('caído');
  });

  it('entra al segundo intento, como en el ejemplo de la tarjeta', async () => {
    await conAvisoEncolado('segundo-intento');
    fallosPendientes = 1;

    await correrJob('dispatchNotifications');
    ahora = ahora.add({ seconds: 30 });
    await correrJob('dispatchNotifications');

    const [email] = await avisosEnBase({ channel: 'email' });
    expect(email?.status).toBe('sent');
    expect(buzon).toHaveLength(1);
  });

  it('🔴 correr el job dos veces no manda el mail dos veces', async () => {
    await conAvisoEncolado('doble-corrida');

    await Promise.all([correrJob('dispatchNotifications'), correrJob('dispatchNotifications')]);

    expect(buzon).toHaveLength(1);
  });

  it('el in-app no espera a nadie: la fila es la notificación', async () => {
    await conAvisoEncolado('in-app-directo');
    fallosPendientes = 99;

    await correrJob('dispatchNotifications');

    const [inApp] = await avisosEnBase({ channel: 'in_app' });
    expect(inApp?.status).toBe('sent');
  });
});

describe('la deduplicación (§2.1.14)', () => {
  it('🔴 el mismo aviso encolado dos veces entra una sola', async () => {
    const centro = await nuevoCentro('dedupe');

    const primera = await encolar(centro.organizationId, avisoDeReserva('usr_1'));
    const segunda = await encolar(centro.organizationId, avisoDeReserva('usr_1'));

    expect(primera).toBe(2);
    expect(segunda).toBe(0);
    expect(await avisosEnBase()).toHaveLength(2);
  });

  it('la clave es por persona: el mismo evento le llega a cada uno', async () => {
    const centro = await nuevoCentro('dedupe-persona');

    await encolar(centro.organizationId, avisoDeReserva('usr_1'));
    await encolar(centro.organizationId, avisoDeReserva('usr_2'));

    expect(await avisosEnBase()).toHaveLength(4);
  });
});

describe('la ventana horaria (§2.1.14)', () => {
  it('🔴 el mail que caería a las 3 AM se difiere hasta las 8', async () => {
    const centro = await nuevoCentro('madrugada');
    // 06:00 UTC son las 03:00 en Buenos Aires.
    ahora = Temporal.Instant.from('2026-03-03T06:00:00Z');

    await encolar(centro.organizationId, avisoDeReserva('usr_1'));

    const [email] = await avisosEnBase({ channel: 'email' });
    // 08:00 local del mismo día = 11:00 UTC.
    expect(email?.nextAttemptAt?.toISOString()).toBe('2026-03-03T11:00:00.000Z');
  });

  it('la campana no se difiere: quien reserva a las 23:00 lo ve al toque', async () => {
    const centro = await nuevoCentro('campana-nocturna');
    // 02:00 UTC del 4 son las 23:00 del 3 en Buenos Aires.
    ahora = Temporal.Instant.from('2026-03-04T02:00:00Z');

    await encolar(centro.organizationId, avisoDeReserva('usr_1'));

    const avisos = await avisosEnBase();
    const inApp = avisos.find((aviso) => aviso.channel === 'in_app');
    const email = avisos.find((aviso) => aviso.channel === 'email');

    expect(inApp?.nextAttemptAt?.toISOString()).toBe('2026-03-04T02:00:00.000Z');
    expect(email?.nextAttemptAt?.toISOString()).toBe('2026-03-04T11:00:00.000Z');
  });
});

describe('las preferencias del usuario (§2.1.14)', () => {
  it('sin tocar nada, llegan todos los avisos por todos los canales', async () => {
    const centro = await centroListo('prefs-default');
    const socio = await socioListo(centro, 'Micaela');

    const res = await app.request('/api/v1/notification-preferences', req(socio.cookie, 'GET'));
    const body = (await res.json()) as NotificationPreference[];

    expect(res.status).toBe(200);
    expect(body.every((pref) => pref.enabled)).toBe(true);
  });

  it('🔴 apagado el mail de un aviso, ese aviso solo llega a la campana', async () => {
    const centro = await centroListo('opt-out');
    const socio = await socioListo(centro, 'Micaela');

    await app.request(
      '/api/v1/notification-preferences',
      req(socio.cookie, 'PUT', {
        preferences: [{ eventType: 'booking.created', channel: 'email', enabled: false }],
      }),
    );
    await reservar(centro, socio.memberId);

    const avisos = await avisosEnBase();
    expect(avisos.map((aviso) => aviso.channel)).toEqual(['in_app']);
  });

  it('🔴 los avisos de plata salen igual: el opt-out no los alcanza', async () => {
    const centro = await centroListo('criticos');
    const socio = await socioListo(centro, 'Micaela');

    const res = await app.request(
      '/api/v1/notification-preferences',
      req(socio.cookie, 'PUT', {
        preferences: [{ eventType: 'charge.overdue', channel: 'email', enabled: false }],
      }),
    );
    const body = (await res.json()) as NotificationPreference[];
    const critico = body.find(
      (pref) => pref.eventType === 'charge.overdue' && pref.channel === 'email',
    );

    // La respuesta dice la verdad: el interruptor no lo apaga.
    expect(critico?.enabled).toBe(true);
    expect(critico?.critical).toBe(true);

    await encolar(centro.organizationId, {
      eventType: 'charge.overdue',
      userId: socio.memberId,
      email: socio.email,
      subjectId: 'chg_1',
      timeZone: AR,
      values: { nombre: 'Micaela', monto: '$18.000', vencimiento: '1 de marzo' },
    });

    expect(await avisosEnBase({ channel: 'email' })).toHaveLength(1);
  });

  it('el opt-out es de cada uno: apagarlo yo no lo apaga para el resto', async () => {
    const centro = await centroListo('opt-out-ajeno');
    const micaela = await socioListo(centro, 'Micaela');
    const julian = await socioListo(centro, 'Julian');

    await app.request(
      '/api/v1/notification-preferences',
      req(micaela.cookie, 'PUT', {
        preferences: [{ eventType: 'booking.created', channel: 'email', enabled: false }],
      }),
    );
    await reservar(centro, micaela.memberId);
    await reservar(centro, julian.memberId);

    expect(await avisosEnBase({ channel: 'email' })).toHaveLength(1);
  });
});

describe('las plantillas del SMU (§2.1.14)', () => {
  it('de fábrica vienen todas, marcadas como default', async () => {
    const centro = await nuevoCentro('plantillas');

    const res = await app.request('/api/v1/notification-templates', req(centro.cookie, 'GET'));
    const body = (await res.json()) as NotificationTemplate[];

    expect(res.status).toBe(200);
    expect(body.every((plantilla) => plantilla.isDefault)).toBe(true);
    expect(body.find((p) => p.eventType === 'booking.created')?.variables).toContain('clase');
  });

  it('🔴 una variable que no existe se rechaza al guardar, no al enviar', async () => {
    const centro = await nuevoCentro('plantilla-invalida');

    const res = await app.request(
      '/api/v1/notification-templates',
      req(centro.cookie, 'PUT', {
        eventType: 'booking.created',
        channel: 'email',
        subject: 'Reservaste',
        body: 'Hola {{apodo}}, reservaste {{clase}}.',
      }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-NOTF-422-002');
  });

  it('la plantilla guardada es la que sale', async () => {
    const centro = await centroListo('plantilla-propia');
    const socio = await socioListo(centro, 'Micaela');

    await app.request(
      '/api/v1/notification-templates',
      req(centro.cookie, 'PUT', {
        eventType: 'booking.created',
        channel: 'in_app',
        subject: 'Anotada',
        body: 'Dale {{nombre}}, te esperamos en {{clase}}.',
      }),
    );
    await reservar(centro, socio.memberId);

    const [inApp] = await avisosEnBase({ channel: 'in_app' });
    expect(inApp?.body).toBe('Dale Micaela, te esperamos en Funcional.');
  });

  it('apagar la plantilla apaga el aviso para todo el centro', async () => {
    const centro = await centroListo('plantilla-apagada');
    const socio = await socioListo(centro, 'Micaela');

    for (const channel of ['in_app', 'email']) {
      await app.request(
        '/api/v1/notification-templates',
        req(centro.cookie, 'PUT', {
          eventType: 'booking.created',
          channel,
          subject: 'Reservaste {{clase}}',
          body: 'Hola {{nombre}}.',
          enabled: false,
        }),
      );
    }
    await reservar(centro, socio.memberId);

    expect(await avisosEnBase()).toHaveLength(0);
  });

  it('la vista previa resuelve las variables con datos de ejemplo', async () => {
    const centro = await nuevoCentro('preview');

    const res = await app.request(
      '/api/v1/notification-templates/preview',
      req(centro.cookie, 'POST', {
        eventType: 'booking.created',
        channel: 'email',
        subject: 'Reservaste {{clase}}',
        body: 'Hola {{nombre}}, te esperamos el {{fecha}}.',
      }),
    );
    const body = (await res.json()) as { subject: string; body: string };

    expect(res.status).toBe(200);
    expect(body.subject).toBe('Reservaste Funcional');
    expect(body.body).not.toContain('{{');
  });

  it('un coach no edita las plantillas del centro', async () => {
    const centro = await centroListo('plantilla-coach');
    const coach = await atletaDe(centro, 'Coach');
    await auth.api.updateMemberRole({
      body: {
        organizationId: centro.organizationId,
        memberId: await orgMemberIdOf(coach.cookie),
        role: 'coach',
      },
      headers: { cookie: centro.cookie },
    });

    const res = await app.request(
      '/api/v1/notification-templates',
      req(coach.cookie, 'PUT', {
        eventType: 'booking.created',
        channel: 'email',
        subject: 'Hola',
        body: 'Hola {{nombre}}.',
      }),
    );

    expect(res.status).toBe(403);
  });
});

describe('la campana del usuario', () => {
  it('el socio ve sus avisos y los sin leer', async () => {
    const centro = await centroListo('campana');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    const lista = await app.request('/api/v1/notifications', req(socio.cookie, 'GET'));
    const body = (await lista.json()) as { items: Notification[] };
    const contador = await app.request(
      '/api/v1/notifications/unread-count',
      req(socio.cookie, 'GET'),
    );

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.channel).toBe('in_app');
    expect(await contador.json()).toEqual({ unread: 1 });
  });

  it('marcarlo leído lo saca del contador', async () => {
    const centro = await centroListo('leido');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);
    const [aviso] = await avisosEnBase({ channel: 'in_app' });

    await app.request(
      `/api/v1/notifications/${aviso?.publicId}/read`,
      req(socio.cookie, 'POST', {}),
    );

    const contador = await app.request(
      '/api/v1/notifications/unread-count',
      req(socio.cookie, 'GET'),
    );
    expect(await contador.json()).toEqual({ unread: 0 });
  });

  it('🔴 la campana de uno no marca los avisos de otro', async () => {
    const centro = await centroListo('campana-ajena');
    const micaela = await socioListo(centro, 'Micaela');
    const julian = await socioListo(centro, 'Julian');
    await reservar(centro, micaela.memberId);
    const [aviso] = await avisosEnBase({ channel: 'in_app' });

    await app.request(
      `/api/v1/notifications/${aviso?.publicId}/read`,
      req(julian.cookie, 'POST', {}),
    );

    const [sigue] = await avisosEnBase({ channel: 'in_app' });
    expect(sigue?.readAt).toBeNull();
  });

  it('el mail no aparece en la campana: ya llegó por otro lado', async () => {
    const centro = await centroListo('campana-sin-mail');
    const socio = await socioListo(centro, 'Micaela');
    await reservar(centro, socio.memberId);

    const lista = await app.request('/api/v1/notifications', req(socio.cookie, 'GET'));
    const body = (await lista.json()) as { items: Notification[] };

    expect(body.items.every((aviso) => aviso.channel === 'in_app')).toBe(true);
  });
});

describe('el registro de entregas (§2.1.14)', () => {
  it('🔴 "no me llegó el aviso" tiene respuesta: qué se intentó y por qué falló', async () => {
    const centro = await centroListo('soporte');
    const socio = await socioListo(centro, 'Micaela');
    fallosPendientes = 99;
    await reservar(centro, socio.memberId);
    await correrJob('dispatchNotifications');

    const res = await app.request(
      '/api/v1/notification-deliveries?status=queued',
      req(centro.cookie, 'GET'),
    );
    const body = (await res.json()) as { items: DeliveryLogEntry[] };

    expect(res.status).toBe(200);
    expect(body.items[0]?.attempts).toBe(1);
    expect(body.items[0]?.lastError).toContain('caído');
    expect(body.items[0]?.nextAttemptAt).not.toBeNull();
  });

  it('el socio no ve el registro de entregas del centro', async () => {
    const centro = await centroListo('soporte-socio');
    const socio = await socioListo(centro, 'Micaela');

    const res = await app.request('/api/v1/notification-deliveries', req(socio.cookie, 'GET'));

    expect(res.status).toBe(403);
  });
});

/*
 * Una query mal escrita es error del que la escribe, no del servidor: tiene que
 * volver 422 con el código del envelope (§5.0). El 500 genérico le dice al
 * usuario "se rompió algo" cuando lo único que pasa es que el filtro está mal.
 */
describe('una query inválida vuelve 422, no 500', () => {
  it('un `limit` que no es número en la campana se rechaza con LP-SYS-422-006', async () => {
    const { cookie } = await nuevoCentro('query-invalida');

    const res = await app.request('/api/v1/notifications?limit=abc', req(cookie, 'GET'));

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });

  it('un `limit` fuera de rango en el registro de entregas se rechaza igual', async () => {
    const { cookie } = await nuevoCentro('query-invalida-entregas');

    const res = await app.request('/api/v1/notification-deliveries?limit=0', req(cookie, 'GET'));

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve los avisos del otro centro', async () => {
    const victima = await centroListo('ntf-victima');
    const socio = await socioListo(victima, 'Micaela');
    await reservar(victima, socio.memberId);
    const atacante = await centroListo('ntf-atacante');

    const res = await app.request('/api/v1/notification-deliveries', req(atacante.cookie, 'GET'));
    const body = (await res.json()) as { items: DeliveryLogEntry[] };

    expect(body.items).toEqual([]);
  });

  it('las plantillas de un centro no se ven desde el otro', async () => {
    const victima = await nuevoCentro('ntf-tpl-victima');
    await app.request(
      '/api/v1/notification-templates',
      req(victima.cookie, 'PUT', {
        eventType: 'booking.created',
        channel: 'in_app',
        subject: 'Secreto del otro centro',
        body: 'Hola {{nombre}}.',
      }),
    );
    const atacante = await nuevoCentro('ntf-tpl-atacante');

    const res = await app.request('/api/v1/notification-templates', req(atacante.cookie, 'GET'));

    expect(await res.text()).not.toContain('Secreto del otro centro');
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  const esDeNotifications = (path: string) =>
    path.startsWith('/api/v1/notification') || path.startsWith('/api/v1/notifications');

  it('las nueve rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter((route) => esDeNotifications(route.path));

    expect(rutas).toHaveLength(9);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('ntf-fixtures');
    const victima = await nuevoCentro('ntf-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!esDeNotifications(route.path) || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        VICTIM_NOTIFICATION_SUBJECT,
      );
    }
  });
});

/** El id de membresía de una cuenta en la organización activa, para cambiarle el rol. */
async function orgMemberIdOf(cookie: string): Promise<string> {
  const res = await app.request('/api/v1/auth/organization/get-full-organization', {
    method: 'GET',
    headers: { cookie },
  });
  const org = (await res.json()) as { members: Array<{ id: string; userId: string }> };
  const sesion = await app.request('/api/v1/auth/get-session', {
    method: 'GET',
    headers: { cookie },
  });
  const { user } = (await sesion.json()) as { user: { id: string } };

  return org.members.find((miembro) => miembro.userId === user.id)?.id as string;
}
