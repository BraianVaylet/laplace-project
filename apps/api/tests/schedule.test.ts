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
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { VICTIM_TEMPLATE_NAME } from '../src/modules/schedule/infrastructure/routes.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-12. La agenda del centro (§2.1.5.a): plantillas recurrentes y las sesiones
 * concretas que un job materializa en una ventana de 60 días.
 *
 * Lo que se verifica y no se negocia: la idempotencia del job, que la clase de
 * las 7:00 siga siendo a las 7:00 cruzando un cambio de horario, y la colisión
 * de sala.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902150000-session-materialization-unique.cjs'),
  require('../../../migrations/20260902160000-venue-closures.cjs'),
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
 * Reemplazan a Booking (F1-14) y a Notifications (F1-21), que todavía no
 * existen. Guardan qué se pidió liberar y qué avisos salieron.
 */
const liberadas: Array<{ sessionId: string; reason: string }> = [];
const avisos: Array<{ evento: string; sessionId: string }> = [];
/** A quienes se les libero la reserva: el evento los lleva para poder avisarles. */
const LIBERADOS = ['mem_uno', 'mem_dos', 'mem_tres'];
const RESERVAS_POR_CLASE = LIBERADOS.length;
let fallarLiberacion = false;

/** Lunes 2 de marzo de 2026, 09:00 en Buenos Aires. */
let ahora = Temporal.Instant.from('2026-03-02T12:00:00Z');

interface TemplateBody {
  publicId: string;
  name: string;
  active: boolean;
  capacity?: number;
}
interface SessionBody {
  publicId: string;
  name: string;
  startAt: string;
  endAt: string;
  capacity: number;
  status: string;
  templateId?: string;
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

const req = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function post<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

/** Un centro con sede y su sala por default, listo para armar la grilla. */
async function centroConSala(nombre: string, timeZone = 'America/Argentina/Buenos_Aires') {
  const centro = await nuevoCentro(nombre);
  const sede = await post<{ publicId: string }>(centro.cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone,
  });

  const salas = await app.request(
    `/api/v1/rooms?venueId=${sede.publicId}`,
    req(centro.cookie, 'GET'),
  );
  const items = ((await salas.json()) as { items: Array<{ publicId: string }> }).items;

  return { ...centro, venueId: sede.publicId, roomId: items[0]?.publicId as string, timeZone };
}

type Centro = Awaited<ReturnType<typeof centroConSala>>;

async function crearPlantilla(centro: Centro, overrides: Record<string, unknown> = {}) {
  return post<TemplateBody>(centro.cookie, '/api/v1/class-templates', {
    venueId: centro.venueId,
    roomId: centro.roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    durationMin: 60,
    recurrence: { byWeekday: [1, 2, 3, 4, 5], timeOfDay: '07:00', from: '2026-03-02' },
    ...overrides,
  });
}

async function agenda(centro: Centro, from = '2026-03-01T00:00:00Z', to = '2026-06-01T00:00:00Z') {
  const res = await app.request(
    `/api/v1/sessions?venueId=${centro.venueId}&from=${from}&to=${to}`,
    req(centro.cookie, 'GET'),
  );

  return (await res.json()) as SessionBody[];
}

const correrJob = async (name: string) => {
  const job = modules.jobs.find((candidate) => candidate.name === name);
  if (!job) throw new Error(`no existe el job ${name}`);

  await job.handler();
};

const localDe = (iso: string, timeZone: string) =>
  Temporal.Instant.from(iso)
    .toZonedDateTimeISO(timeZone)
    .toString({ offset: 'never', timeZoneName: 'never' });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_schedule_test' });
  // El unico `{ tenantId, templateId, startAt }` es lo que hace idempotente al
  // job aun con dos instancias del runner: se prueba contra el indice real.
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5174'],
    emailSender,
    rateLimitEnabled: false,
  });

  const events = createEventBus(logger);
  for (const evento of ['session.cancelled', 'session.coach_changed'] as const) {
    events.on(evento, (payload) => {
      avisos.push({ evento, sessionId: (payload as { sessionId: string }).sessionId });
    });
  }

  modules = createModules({
    events,
    entitlements,
    logger,
    now: () => ahora,
    memberships: { add: () => Promise.resolve() },
    sessionBookings: {
      releaseSession: (params) => {
        if (fallarLiberacion) return Promise.reject(new Error('la devolución falló'));
        liberadas.push(params);

        return Promise.resolve(LIBERADOS);
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
  liberadas.length = 0;
  avisos.length = 0;
  fallarLiberacion = false;
  entitlements.invalidateAll();
  for (const coleccion of [
    'classTemplates',
    'classSessions',
    'venueClosures',
    'auditLogs',
    'rooms',
    'venues',
  ]) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('plantillas', () => {
  it('define nombre, categoría, duración, sala y recurrencia', async () => {
    const centro = await centroConSala('plantilla');

    const plantilla = await crearPlantilla(centro);

    expect(plantilla.name).toBe('Funcional');
    expect(plantilla.active).toBe(true);
  });

  it('rechaza una recurrencia que no genera ninguna clase', async () => {
    const centro = await centroConSala('recurrencia-vacia');

    // Lunes a viernes con vigencia solo el sábado: no genera nada nunca.
    const res = await app.request(
      '/api/v1/class-templates',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        roomId: centro.roomId,
        name: 'Imposible',
        categoryId: 'funcional',
        durationMin: 60,
        recurrence: {
          byWeekday: [1, 2, 3, 4, 5],
          timeOfDay: '07:00',
          from: '2026-03-07',
          until: '2026-03-07',
        },
      }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SCHD-422-004');
  });

  it('rechaza una sala que no existe en el centro', async () => {
    const centro = await centroConSala('sala-fantasma');

    const res = await app.request(
      '/api/v1/class-templates',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        roomId: 'rom_no_existe',
        name: 'Funcional',
        categoryId: 'funcional',
        durationMin: 60,
        recurrence: { byWeekday: [1], timeOfDay: '07:00', from: '2026-03-02' },
      }),
    );

    expect(res.status).toBe(404);
  });

  it('archivar la plantilla NO borra las clases ya materializadas', async () => {
    const centro = await centroConSala('archivar');
    const plantilla = await crearPlantilla(centro);
    await correrJob('materializeSessions');
    const antes = (await agenda(centro)).length;

    await app.request(
      `/api/v1/class-templates/${plantilla.publicId}/archive`,
      req(centro.cookie, 'POST', {}),
    );

    // La clase del jueves ya está publicada y puede tener gente anotada: para
    // bajarla hay que cancelarla, que avisa y devuelve créditos (F1-13).
    expect((await agenda(centro)).length).toBe(antes);
  });
});

describe('🔴 materialización (§2.1.5.a)', () => {
  it('genera las clases de los próximos 60 días', async () => {
    const centro = await centroConSala('materializa');
    await crearPlantilla(centro);

    await correrJob('materializeSessions');
    const clases = await agenda(centro);

    // Lunes a viernes durante 60 días son entre 42 y 44 clases.
    expect(clases.length).toBeGreaterThanOrEqual(42);
    expect(clases.length).toBeLessThanOrEqual(44);
    expect(clases[0]?.name).toBe('Funcional');
  });

  it('NO duplica: correr el job dos veces deja la misma grilla', async () => {
    const centro = await centroConSala('idempotente');
    await crearPlantilla(centro);

    await correrJob('materializeSessions');
    const primera = (await agenda(centro)).length;
    await correrJob('materializeSessions');

    // El runner garantiza que no corran dos a la vez, no que no corran dos veces.
    expect((await agenda(centro)).length).toBe(primera);
  });

  it('el índice único corta el duplicado aunque dos corridas se pisen', async () => {
    const centro = await centroConSala('idempotente-carrera');
    await crearPlantilla(centro);

    await Promise.all([correrJob('materializeSessions'), correrJob('materializeSessions')]);
    const clases = await agenda(centro);
    const inicios = new Set(clases.map((clase) => clase.startAt));

    // Sin el índice, la ventana entre la consulta y el insert duplicaría la
    // grilla y el socio la vería dos veces.
    expect(inicios.size).toBe(clases.length);
  });

  it('la clase hereda la capacidad de la sala (§2.1.5.b)', async () => {
    const centro = await centroConSala('capacidad');
    await app.request(
      `/api/v1/rooms/${centro.roomId}`,
      req(centro.cookie, 'PATCH', { capacity: 16 }),
    );
    await crearPlantilla(centro);

    await correrJob('materializeSessions');

    expect((await agenda(centro))[0]?.capacity).toBe(16);
  });

  it('la plantilla puede sobreescribir la capacidad de la sala', async () => {
    const centro = await centroConSala('capacidad-override');
    await crearPlantilla(centro, { capacity: 8 });

    await correrJob('materializeSessions');

    expect((await agenda(centro))[0]?.capacity).toBe(8);
  });

  it('una plantilla archivada deja de generar clases nuevas', async () => {
    const centro = await centroConSala('archivada-no-genera');
    const plantilla = await crearPlantilla(centro);
    await app.request(
      `/api/v1/class-templates/${plantilla.publicId}/archive`,
      req(centro.cookie, 'POST', {}),
    );

    await correrJob('materializeSessions');

    expect(await agenda(centro)).toHaveLength(0);
  });

  it('materializa las de todos los centros, cada uno en su contexto', async () => {
    const uno = await centroConSala('mat-tenant-a');
    const otro = await centroConSala('mat-tenant-b');
    await crearPlantilla(uno);
    await crearPlantilla(otro);

    await correrJob('materializeSessions');

    expect((await agenda(uno)).length).toBeGreaterThan(0);
    expect((await agenda(otro)).length).toBeGreaterThan(0);
  });

  it('respeta el `until` de la vigencia', async () => {
    const centro = await centroConSala('hasta');
    await crearPlantilla(centro, {
      recurrence: {
        byWeekday: [1, 2, 3, 4, 5],
        timeOfDay: '07:00',
        from: '2026-03-02',
        until: '2026-03-06',
      },
    });

    await correrJob('materializeSessions');

    /*
     * Cuatro, no cinco: el reloj está en el lunes 09:00 local y la clase del
     * lunes era a las 07:00. El job materializa hacia adelante y no crea
     * retroactivamente una clase que ya pasó — que además nadie podría reservar.
     */
    const clases = await agenda(centro);
    expect(clases).toHaveLength(4);
    expect(localDe(clases[0]?.startAt as string, centro.timeZone)).toBe('2026-03-03T07:00:00');
  });
});

describe('🔴 cambio de horario de verano', () => {
  it('la clase de las 7:00 sigue siendo a las 7:00 locales', async () => {
    // Santiago adelanta el reloj el 6 de septiembre de 2026.
    const centro = await centroConSala('dst', 'America/Santiago');
    ahora = Temporal.Instant.from('2026-08-31T12:00:00Z');
    await crearPlantilla(centro, {
      recurrence: {
        byWeekday: [1, 2, 3, 4, 5, 6, 7],
        timeOfDay: '07:00',
        from: '2026-09-01',
        until: '2026-09-14',
      },
    });

    await correrJob('materializeSessions');
    const clases = await agenda(centro, '2026-08-01T00:00:00Z', '2026-10-01T00:00:00Z');

    expect(clases.length).toBeGreaterThan(10);
    for (const clase of clases) {
      // Con sumas de 24 h, las de después del cambio caerían a las 8:00 y el
      // socio se encontraría el gimnasio cerrado.
      expect(localDe(clase.startAt, 'America/Santiago'), clase.startAt).toContain('T07:00:00');
    }
  });
});

describe('clases sueltas y colisión de sala', () => {
  const claseSuelta = (centro: Centro, overrides: Record<string, unknown> = {}) =>
    app.request(
      '/api/v1/sessions',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        roomId: centro.roomId,
        name: 'Seminario de halterofilia',
        categoryId: 'halterofilia',
        startAt: '2026-03-10T13:00:00Z',
        durationMin: 90,
        ...overrides,
      }),
    );

  it('crea una clase fuera de toda plantilla', async () => {
    const centro = await centroConSala('suelta');

    const res = await claseSuelta(centro);
    const body = (await res.json()) as SessionBody;

    expect(res.status).toBe(201);
    expect(body.templateId).toBeUndefined();
    expect(body.status).toBe('scheduled');
  });

  it('dos clases en la misma sala y horario responden LP-SCHD-409-003', async () => {
    const centro = await centroConSala('colision');
    await claseSuelta(centro);

    const res = await claseSuelta(centro, { name: 'Otra cosa', startAt: '2026-03-10T14:00:00Z' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-SCHD-409-003');
    // Sin el nombre y la hora, el SMU tiene que salir a buscarla en la grilla.
    expect(body.error.action).toContain('Seminario');
  });

  it('los bordes que se tocan no chocan: es la grilla normal de un box', async () => {
    const centro = await centroConSala('bordes');
    await claseSuelta(centro, { durationMin: 60 });

    const res = await claseSuelta(centro, {
      name: 'La siguiente',
      startAt: '2026-03-10T14:00:00Z',
    });

    expect(res.status).toBe(201);
  });

  it('la misma hora en otra sala no choca', async () => {
    const centro = await centroConSala('otra-sala');
    const otra = await post<{ publicId: string }>(centro.cookie, '/api/v1/rooms', {
      venueId: centro.venueId,
      name: 'Sala 2',
      capacity: 10,
    });
    await claseSuelta(centro);

    const res = await claseSuelta(centro, { roomId: otra.publicId });

    expect(res.status).toBe(201);
  });
});

describe('la deuda de F1-02, saldada', () => {
  it('una sala con clases programadas ya no se puede borrar', async () => {
    const centro = await centroConSala('deuda-f102');
    await crearPlantilla(centro);
    await correrJob('materializeSessions');

    const res = await app.request(`/api/v1/rooms/${centro.roomId}`, req(centro.cookie, 'DELETE'));
    const body = (await res.json()) as ErrorBody;

    /*
     * F1-02 dejó el bloqueo escrito contra un puerto que respondía 0. Ahora lo
     * contesta Schedule de verdad, y el borrado corta.
     */
    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-SCHD-409-002');
    expect(body.error.action).toContain('archivarla');
  });

  it('una sala sin clases futuras se sigue pudiendo borrar', async () => {
    const centro = await centroConSala('deuda-f102-libre');

    const res = await app.request(`/api/v1/rooms/${centro.roomId}`, req(centro.cookie, 'DELETE'));

    expect(res.status).toBe(204);
  });

  it('las clases que ya pasaron no bloquean el borrado', async () => {
    const centro = await centroConSala('deuda-f102-pasadas');
    await crearPlantilla(centro);
    await correrJob('materializeSessions');

    // Un año después, ninguna de esas clases es futura.
    ahora = Temporal.Instant.from('2027-03-02T12:00:00Z');

    const res = await app.request(`/api/v1/rooms/${centro.roomId}`, req(centro.cookie, 'DELETE'));

    expect(res.status).toBe(204);
  });
});

describe('edición "solo esta / esta y futuras" (§2.1.5.a)', () => {
  /** Un centro con la grilla ya materializada. */
  async function conGrilla(nombre: string) {
    const centro = await centroConSala(nombre);
    const plantilla = await crearPlantilla(centro);
    await correrJob('materializeSessions');

    return { ...centro, templateId: plantilla.publicId };
  }

  it('editar una sesión afecta solo a esa sesión', async () => {
    const centro = await conGrilla('solo-esta');
    const clases = await agenda(centro);
    const objetivo = clases[0] as SessionBody;

    await app.request(
      `/api/v1/sessions/${objetivo.publicId}`,
      req(centro.cookie, 'PATCH', { name: 'Funcional AVANZADO', capacity: 8 }),
    );
    const despues = await agenda(centro);

    expect(despues[0]?.name).toBe('Funcional AVANZADO');
    expect(despues[0]?.capacity).toBe(8);
    // Las demás quedan como estaban: es la mitad "solo esta".
    expect(despues[1]?.name).toBe('Funcional');
  });

  it('editar la plantilla sin `scope` no toca la grilla ya publicada', async () => {
    const centro = await conGrilla('template-only');

    await app.request(
      `/api/v1/class-templates/${centro.templateId}`,
      req(centro.cookie, 'PATCH', { name: 'Otro nombre' }),
    );

    // Propagar por default reescribiría clases publicadas sin que nadie lo pida.
    expect((await agenda(centro))[0]?.name).toBe('Funcional');
  });

  it('con `scope=this_and_future` propaga a las que no empezaron', async () => {
    const centro = await conGrilla('esta-y-futuras');
    const antes = await agenda(centro);

    const res = await app.request(
      `/api/v1/class-templates/${centro.templateId}?scope=this_and_future`,
      req(centro.cookie, 'PATCH', { name: 'Funcional Renovado', capacity: 12 }),
    );
    const body = (await res.json()) as { updatedSessions: number };
    const despues = await agenda(centro);

    expect(body.updatedSessions).toBe(antes.length);
    expect(despues.every((clase) => clase.name === 'Funcional Renovado')).toBe(true);
    expect(despues.every((clase) => clase.capacity === 12)).toBe(true);
  });

  it('🔴 las clases pasadas NUNCA se tocan', async () => {
    const centro = await conGrilla('pasadas-intactas');
    // Un mes después, media grilla ya ocurrió.
    ahora = Temporal.Instant.from('2026-04-02T12:00:00Z');

    await app.request(
      `/api/v1/class-templates/${centro.templateId}?scope=this_and_future`,
      req(centro.cookie, 'PATCH', { name: 'Funcional Renovado' }),
    );
    const todas = await agenda(centro);

    /*
     * Las pasadas son el histórico de lo que de verdad ocurrió: reescribirlas
     * haría que la lista de asistencia de la semana pasada dejara de coincidir
     * con lo que la gente hizo.
     */
    // Contra el instante exacto del reloj, no contra el día: la clase de las
    // 07:00 locales del 2 de abril ya pasó cuando son las 09:00.
    const AHORA = ahora.toString();
    const pasadas = todas.filter((clase) => clase.startAt < AHORA);
    const futuras = todas.filter((clase) => clase.startAt > AHORA);

    expect(pasadas.length).toBeGreaterThan(0);
    expect(pasadas.every((clase) => clase.name === 'Funcional')).toBe(true);
    expect(futuras.every((clase) => clase.name === 'Funcional Renovado')).toBe(true);
  });

  it('el cambio de coach avisa a los inscriptos (§2.1.5.f)', async () => {
    const centro = await conGrilla('coach');
    const clase = (await agenda(centro))[0] as SessionBody;
    avisos.length = 0;

    await app.request(
      `/api/v1/sessions/${clase.publicId}`,
      req(centro.cookie, 'PATCH', { coachId: 'usr_coach_nuevo' }),
    );

    // El socio eligió esa clase, y a veces eligió a esa persona.
    expect(avisos).toContainEqual({ evento: 'session.coach_changed', sessionId: clase.publicId });
  });

  it('una clase que ya pasó no se edita', async () => {
    const centro = await conGrilla('pasada-no-edita');
    const clase = (await agenda(centro))[0] as SessionBody;
    ahora = Temporal.Instant.from('2026-05-02T12:00:00Z');

    const res = await app.request(
      `/api/v1/sessions/${clase.publicId}`,
      req(centro.cookie, 'PATCH', { name: 'Tarde' }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SCHD-422-005');
  });
});

describe('🔴 cancelación de clase con devolución (§2.1.9)', () => {
  async function conGrilla(nombre: string) {
    const centro = await centroConSala(nombre);
    await crearPlantilla(centro);
    await correrJob('materializeSessions');

    return centro;
  }

  it('cancela la clase, libera las reservas y avisa', async () => {
    const centro = await conGrilla('cancelar');
    const clase = (await agenda(centro))[0] as SessionBody;
    liberadas.length = 0;
    avisos.length = 0;

    const res = await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', { reason: 'Se cortó la luz.' }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as SessionBody).status).toBe('cancelled');
    expect(liberadas).toEqual([{ sessionId: clase.publicId, reason: 'Se cortó la luz.' }]);
    expect(avisos).toContainEqual({ evento: 'session.cancelled', sessionId: clase.publicId });
  });

  it('deja la cancelación en el AuditLog', async () => {
    const centro = await conGrilla('cancelar-audit');
    const clase = (await agenda(centro))[0] as SessionBody;

    await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', { reason: 'Coach enfermo.' }),
    );

    const auditoria = await mongoose.connection.db
      ?.collection('auditLogs')
      .findOne<{ reason: string; after: { bookingsReleased: number } }>({
        targetId: clase.publicId,
      });

    expect(auditoria?.reason).toBe('Coach enfermo.');
    expect(auditoria?.after.bookingsReleased).toBe(RESERVAS_POR_CLASE);
  });

  it('🔴 si la devolución falla, la clase NO se cancela', async () => {
    const centro = await conGrilla('cancelar-falla');
    const clase = (await agenda(centro))[0] as SessionBody;
    fallarLiberacion = true;

    const res = await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', { reason: 'Se cortó la luz.' }),
    );

    /*
     * Primero se liberan las reservas y después se cancela: al revés quedaría
     * una clase cancelada con los créditos retenidos, que es plata del socio.
     */
    expect(res.status).toBeGreaterThanOrEqual(500);
    const despues = await app.request(
      `/api/v1/sessions/${clase.publicId}`,
      req(centro.cookie, 'GET'),
    );
    expect(((await despues.json()) as SessionBody).status).toBe('scheduled');
  });

  it('sin motivo no se cancela', async () => {
    const centro = await conGrilla('cancelar-sin-motivo');
    const clase = (await agenda(centro))[0] as SessionBody;

    const res = await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
  });

  it('una clase ya terminada no se cancela', async () => {
    const centro = await conGrilla('cancelar-terminada');
    const clase = (await agenda(centro))[0] as SessionBody;
    ahora = Temporal.Instant.from('2026-05-02T12:00:00Z');

    const res = await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', { reason: 'Tarde para esto.' }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SCHD-422-005');
  });

  it('cancelar dos veces no libera dos veces', async () => {
    const centro = await conGrilla('cancelar-doble');
    const clase = (await agenda(centro))[0] as SessionBody;
    await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', { reason: 'Primera vez.' }),
    );
    liberadas.length = 0;

    const res = await app.request(
      `/api/v1/sessions/${clase.publicId}/cancel`,
      req(centro.cookie, 'POST', { reason: 'Segunda vez.' }),
    );

    // Liberar dos veces devolveria el credito dos veces: seria regalar clases.
    expect(res.status).toBe(422);
    expect(liberadas).toEqual([]);
  });
});

describe('feriados y cierres', () => {
  it('cancela en bloque las clases del rango', async () => {
    const centro = await centroConSala('feriado');
    await crearPlantilla(centro);
    await correrJob('materializeSessions');
    liberadas.length = 0;

    const res = await app.request(
      '/api/v1/closures',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        from: '2026-03-09',
        to: '2026-03-13',
        reason: 'Semana de refacciones.',
      }),
    );
    const cierre = (await res.json()) as { cancelledSessions: number };

    expect(res.status).toBe(201);
    // Lunes a viernes de esa semana.
    expect(cierre.cancelledSessions).toBe(5);
    expect(liberadas).toHaveLength(5);

    const clases = await agenda(centro);
    const esaSemana = clases.filter(
      (clase) => clase.startAt >= '2026-03-09' && clase.startAt < '2026-03-14',
    );
    expect(esaSemana.every((clase) => clase.status === 'cancelled')).toBe(true);
  });

  it('un feriado de un día cancela solo ese día', async () => {
    const centro = await centroConSala('feriado-un-dia');
    await crearPlantilla(centro);
    await correrJob('materializeSessions');

    const res = await app.request(
      '/api/v1/closures',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        from: '2026-03-10',
        to: '2026-03-10',
        reason: 'Feriado nacional.',
      }),
    );

    expect(((await res.json()) as { cancelledSessions: number }).cancelledSessions).toBe(1);
  });

  it('no toca las clases que ya se dieron', async () => {
    const centro = await centroConSala('feriado-pasado');
    await crearPlantilla(centro);
    await correrJob('materializeSessions');
    ahora = Temporal.Instant.from('2026-03-20T12:00:00Z');

    const res = await app.request(
      '/api/v1/closures',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        from: '2026-03-09',
        to: '2026-03-13',
        reason: 'Cierre declarado tarde.',
      }),
    );

    // La clase se dio: borrarla del registro sería mentir sobre lo que ocurrió.
    expect(((await res.json()) as { cancelledSessions: number }).cancelledSessions).toBe(0);
  });

  it('el listado de cierres es por sede', async () => {
    const centro = await centroConSala('cierres-listado');
    await app.request(
      '/api/v1/closures',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        from: '2026-03-10',
        to: '2026-03-10',
        reason: 'Feriado.',
      }),
    );

    const res = await app.request(
      `/api/v1/closures?venueId=${centro.venueId}`,
      req(centro.cookie, 'GET'),
    );

    expect((await res.json()) as unknown[]).toHaveLength(1);
  });
});

describe('duplicar una semana', () => {
  const duplicar = (centro: Centro, body: Record<string, unknown>) =>
    app.request('/api/v1/sessions/duplicate-week', req(centro.cookie, 'POST', body));

  it('copia la grilla a la semana siguiente', async () => {
    const centro = await centroConSala('duplicar');
    await post(centro.cookie, '/api/v1/sessions', {
      venueId: centro.venueId,
      roomId: centro.roomId,
      name: 'Funcional',
      categoryId: 'funcional',
      startAt: '2026-03-03T10:00:00Z',
      durationMin: 60,
    });

    const res = await duplicar(centro, {
      venueId: centro.venueId,
      fromWeek: '2026-03-02',
      toWeek: '2026-03-09',
    });
    const body = (await res.json()) as { created: number; skipped: unknown[] };

    expect(body.created).toBe(1);
    expect(body.skipped).toEqual([]);
    expect((await agenda(centro)).map((clase) => clase.startAt.slice(0, 10))).toContain(
      '2026-03-10',
    );
  });

  it('🔴 respeta los feriados de la semana destino', async () => {
    const centro = await centroConSala('duplicar-feriado');
    await post(centro.cookie, '/api/v1/sessions', {
      venueId: centro.venueId,
      roomId: centro.roomId,
      name: 'Funcional',
      categoryId: 'funcional',
      startAt: '2026-03-03T10:00:00Z',
      durationMin: 60,
    });
    await app.request(
      '/api/v1/closures',
      req(centro.cookie, 'POST', {
        venueId: centro.venueId,
        from: '2026-03-10',
        to: '2026-03-10',
        reason: 'Feriado nacional.',
      }),
    );

    const res = await duplicar(centro, {
      venueId: centro.venueId,
      fromWeek: '2026-03-02',
      toWeek: '2026-03-09',
    });
    const body = (await res.json()) as {
      created: number;
      skipped: Array<{ reason: string }>;
    };

    // No se copia, y se dice por qué: el SMU tiene que poder entender el hueco.
    expect(body.created).toBe(0);
    expect(body.skipped[0]?.reason).toBe('Feriado nacional.');
  });

  it('no duplica sobre una sala ya ocupada', async () => {
    const centro = await centroConSala('duplicar-colision');
    for (const startAt of ['2026-03-03T10:00:00Z', '2026-03-10T10:00:00Z']) {
      await post(centro.cookie, '/api/v1/sessions', {
        venueId: centro.venueId,
        roomId: centro.roomId,
        name: 'Funcional',
        categoryId: 'funcional',
        startAt,
        durationMin: 60,
      });
    }

    const res = await duplicar(centro, {
      venueId: centro.venueId,
      fromWeek: '2026-03-02',
      toWeek: '2026-03-09',
    });
    const body = (await res.json()) as { created: number; skipped: Array<{ reason: string }> };

    expect(body.created).toBe(0);
    expect(body.skipped[0]?.reason).toContain('ocupada');
  });
});

/*
 * Una query mal escrita es error del que la escribe, no del servidor: tiene que
 * volver 422 con el código del envelope (§5.0). El 500 genérico le dice al
 * usuario "se rompió algo" cuando lo único que pasa es que el filtro está mal.
 */
describe('una query inválida vuelve 422, no 500', () => {
  it('un `limit` fuera de rango en las plantillas se rechaza con LP-SYS-422-006', async () => {
    const { cookie } = await nuevoCentro('query-invalida');

    const res = await app.request('/api/v1/class-templates?limit=0', req(cookie, 'GET'));

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });

  it('un rango de fechas sin formato ISO en la agenda se rechaza igual', async () => {
    const centro = await centroConSala('agenda-query-invalida');

    const res = await app.request(
      `/api/v1/sessions?venueId=${centro.venueId}&from=ayer&to=hoy`,
      req(centro.cookie, 'GET'),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve ni edita la grilla del otro centro', async () => {
    const victima = await centroConSala('sch-victima');
    const plantilla = await crearPlantilla(victima, { name: 'Clase Confidencial' });
    await correrJob('materializeSessions');
    const clase = (await agenda(victima))[0] as SessionBody;
    const atacante = await centroConSala('sch-atacante');

    const verPlantilla = await app.request(
      `/api/v1/class-templates/${plantilla.publicId}`,
      req(atacante.cookie, 'GET'),
    );
    const verClase = await app.request(
      `/api/v1/sessions/${clase.publicId}`,
      req(atacante.cookie, 'GET'),
    );

    expect(verPlantilla.status).toBe(404);
    expect(await verPlantilla.text()).not.toContain('Confidencial');
    expect(verClase.status).toBe(404);
  });

  it('la agenda del atacante sale vacía', async () => {
    const victima = await centroConSala('sch-agenda-victima');
    await crearPlantilla(victima);
    await correrJob('materializeSessions');
    const atacante = await centroConSala('sch-agenda-atacante');

    expect(await agenda(atacante)).toEqual([]);
  });

  it('no se puede armar una clase en la sala de otro centro', async () => {
    const victima = await centroConSala('sch-sala-victima');
    const atacante = await centroConSala('sch-sala-atacante');

    const res = await app.request(
      '/api/v1/sessions',
      req(atacante.cookie, 'POST', {
        venueId: atacante.venueId,
        roomId: victima.roomId,
        name: 'Plantada',
        categoryId: 'funcional',
        startAt: '2026-03-10T13:00:00Z',
        durationMin: 60,
      }),
    );

    expect(res.status).toBe(404);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las trece rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter(
      (route) =>
        // La lista de clase, el check-in y el walk-in cuelgan de `/sessions/:id`
        // pero son de Attendance (F1-18/F1-19), que tiene su propia suite.
        !route.path.includes('/roster') &&
        !route.path.includes('/check-in') &&
        !route.path.endsWith('/walk-in') &&
        (route.path.startsWith('/api/v1/class-templates') ||
          route.path.startsWith('/api/v1/sessions') ||
          route.path.startsWith('/api/v1/closures')),
    );

    expect(rutas).toHaveLength(13);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('sch-fixtures');
    const victima = await nuevoCentro('sch-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      const esDeSchedule =
        !route.path.includes('/roster') &&
        !route.path.includes('/check-in') &&
        (route.path.startsWith('/api/v1/class-templates') ||
          route.path.startsWith('/api/v1/sessions') ||
          route.path.startsWith('/api/v1/closures'));
      if (!esDeSchedule || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(VICTIM_TEMPLATE_NAME);
    }
  });
});
