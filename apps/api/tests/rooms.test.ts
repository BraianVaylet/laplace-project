import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModuleRoutes } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-02. La sala: espacio físico con capacidad y equipamiento.
 *
 * Lo que se verifica y no se negocia: la sala por default que se crea con la
 * sede, que el límite del plan **no** cuente salas, el bloqueo de borrado con
 * clases programadas y el aislamiento de tenant.
 */
let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'basic' }));

/**
 * Cuántas sesiones futuras dice tener cada sala. Reemplaza al módulo Schedule,
 * que todavía no existe (F1-12): lo que se testea es que el bloqueo aplique,
 * no cómo se cuentan las sesiones.
 */
const sesionesFuturas = new Map<string, number>();

interface RoomBody {
  publicId: string;
  venueId: string;
  name: string;
  capacity: number;
  status: string;
  equipment: Array<{ kind: string; quantity: number }>;
}
interface VenueBody {
  publicId: string;
  name: string;
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

let centrosCreados = 0;
/** Un centro listo para operar, con su usuario y su organización activa. */
async function nuevoCentro(nombre: string) {
  const n = ++centrosCreados;
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

async function crearSede(cookie: string, name = 'Box Toro Centro'): Promise<VenueBody> {
  const res = await app.request(
    '/api/v1/venues',
    req(cookie, 'POST', {
      name,
      address: 'Alsina 123, Bahía Blanca',
      timeZone: 'America/Argentina/Buenos_Aires',
    }),
  );
  if (res.status !== 201) throw new Error(`crear sede falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as VenueBody;
}

async function listarSalas(cookie: string, venueId?: string) {
  const query = venueId === undefined ? '' : `?venueId=${venueId}`;
  const res = await app.request(`/api/v1/rooms${query}`, req(cookie, 'GET'));

  return (await res.json()) as { items: RoomBody[]; nextCursor: string | null };
}

/** Un centro con su sede ya creada, que es el punto de partida de casi todo. */
async function centroConSede(nombre: string) {
  const centro = await nuevoCentro(nombre);
  const sede = await crearSede(centro.cookie);

  return { ...centro, sede };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_rooms_test' });

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5174'],
    emailSender,
    rateLimitEnabled: false,
  });

  app = createApp({
    logger,
    corsOrigins: ['http://localhost:5174'],
    auth,
    modules: createModuleRoutes({
      events: createEventBus(logger),
      entitlements,
      logger,
      memberships: { add: () => Promise.resolve() },
      sessions: {
        countFutureSessions: (roomId) => Promise.resolve(sesionesFuturas.get(roomId) ?? 0),
      },
    }),
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(async () => {
  sesionesFuturas.clear();
  entitlements.invalidateAll();
  await mongoose.connection.db?.collection('rooms').deleteMany({});
  await mongoose.connection.db?.collection('venues').deleteMany({});
});

describe('la sala por default', () => {
  it('se crea sola al crear la sede: el 90% nunca ve el concepto (§1.1)', async () => {
    const { cookie, sede } = await centroConSede('default');

    const salas = await listarSalas(cookie, sede.publicId);

    expect(salas.items).toHaveLength(1);
    expect(salas.items[0]?.name).toBe('Principal');
    expect(salas.items[0]?.venueId).toBe(sede.publicId);
  });

  it('cada sede trae la suya, no comparten', async () => {
    const { cookie } = await centroConSede('dos-sedes');
    // El plan Basic admite 1 sola sede, así que la segunda se archiva primero.
    const primera = await listarSalas(cookie);
    await app.request(
      `/api/v1/venues/${primera.items[0]?.venueId}/archive`,
      req(cookie, 'POST', {}),
    );
    const segunda = await crearSede(cookie, 'Box Toro Norte');

    const salas = await listarSalas(cookie);

    expect(salas.items).toHaveLength(2);
    expect(salas.items.map((room) => room.venueId).sort()).toEqual(
      [primera.items[0]?.venueId, segunda.publicId].sort(),
    );
  });

  it('el alta de la sede no se cae si la sala automática falla', async () => {
    // El bus aísla los fallos a propósito: la sede ya está creada, y no poder
    // dar de alta una sede porque su sala automática falló sería peor.
    const events = createEventBus(logger);
    events.on('venue.created', () => {
      throw new Error('boom');
    });

    await expect(
      events.emit('venue.created', { venueId: 'x', name: 'x', timeZone: 'UTC' }),
    ).resolves.toBeUndefined();
  });
});

describe('alta de sala', () => {
  it('crea la sala con nombre, capacidad y equipamiento', async () => {
    const { cookie, sede } = await centroConSede('alta');

    const res = await app.request(
      '/api/v1/rooms',
      req(cookie, 'POST', {
        venueId: sede.publicId,
        name: 'Sala 2',
        capacity: 10,
        equipment: [{ kind: 'bike', quantity: 4 }],
      }),
    );
    const body = (await res.json()) as RoomBody;

    expect(res.status).toBe(201);
    expect(body.name).toBe('Sala 2');
    expect(body.capacity).toBe(10);
    expect(body.equipment[0]?.kind).toBe('bike');
    expect(body.status).toBe('active');
  });

  it('rechaza una sede que no existe con LP-SCHD-404-008', async () => {
    const { cookie } = await centroConSede('sede-fantasma');

    const res = await app.request(
      '/api/v1/rooms',
      req(cookie, 'POST', { venueId: 'ven_no_existe', name: 'Sala 2', capacity: 10 }),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SCHD-404-008');
  });

  it('rechaza una capacidad inválida antes de tocar la base', async () => {
    const { cookie, sede } = await centroConSede('capacidad');

    const res = await app.request(
      '/api/v1/rooms',
      req(cookie, 'POST', { venueId: sede.publicId, name: 'Sala 2', capacity: 0 }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });
});

describe('el límite del plan no cuenta salas (§1.1)', () => {
  it('un centro Basic crea todas las salas que quiera en su única sede', async () => {
    const { cookie, sede } = await centroConSede('sin-limite');

    for (const name of ['Sala 2', 'Sala 3', 'Sala 4', 'Sala 5']) {
      const res = await app.request(
        '/api/v1/rooms',
        req(cookie, 'POST', { venueId: sede.publicId, name, capacity: 8 }),
      );
      expect(res.status, name).toBe(201);
    }

    // La automática más las cuatro.
    expect((await listarSalas(cookie)).items).toHaveLength(5);
  });
});

describe('edición, archivado y filtro', () => {
  it('el PATCH cambia la capacidad', async () => {
    const { cookie } = await centroConSede('patch');
    const sala = (await listarSalas(cookie)).items[0] as RoomBody;

    const res = await app.request(
      `/api/v1/rooms/${sala.publicId}`,
      req(cookie, 'PATCH', { capacity: 24 }),
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as RoomBody).capacity).toBe(24);
  });

  it('archivar y reactivar pasan por la transición explícita', async () => {
    const { cookie } = await centroConSede('archivar');
    const sala = (await listarSalas(cookie)).items[0] as RoomBody;

    const archivada = await app.request(
      `/api/v1/rooms/${sala.publicId}/archive`,
      req(cookie, 'POST', {}),
    );
    expect(((await archivada.json()) as RoomBody).status).toBe('archived');

    const dobleArchivo = await app.request(
      `/api/v1/rooms/${sala.publicId}/archive`,
      req(cookie, 'POST', {}),
    );
    expect(dobleArchivo.status).toBe(422);
    expect(((await dobleArchivo.json()) as ErrorBody).error.code).toBe('LP-SCHD-422-006');

    const reactivada = await app.request(
      `/api/v1/rooms/${sala.publicId}/restore`,
      req(cookie, 'POST', {}),
    );
    expect(((await reactivada.json()) as RoomBody).status).toBe('active');
  });

  it('el listado filtra por sede', async () => {
    const { cookie, sede } = await centroConSede('filtro');
    await app.request(
      '/api/v1/rooms',
      req(cookie, 'POST', { venueId: sede.publicId, name: 'Sala 2', capacity: 8 }),
    );

    expect((await listarSalas(cookie, sede.publicId)).items).toHaveLength(2);
    expect((await listarSalas(cookie, 'ven_otra')).items).toHaveLength(0);
  });

  it('una sala inexistente da 404 con código tipado', async () => {
    const { cookie } = await centroConSede('inexistente');

    const res = await app.request('/api/v1/rooms/rom_no_existe', req(cookie, 'GET'));

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-404-002');
  });
});

describe('borrado', () => {
  it('una sala sin clases programadas se borra', async () => {
    const { cookie } = await centroConSede('borrar');
    const sala = (await listarSalas(cookie)).items[0] as RoomBody;

    const res = await app.request(`/api/v1/rooms/${sala.publicId}`, req(cookie, 'DELETE'));

    expect(res.status).toBe(204);
    expect((await listarSalas(cookie)).items).toHaveLength(0);
  });

  it('con clases programadas se bloquea con LP-SCHD-409-002 y ofrece archivar', async () => {
    const { cookie } = await centroConSede('con-clases');
    const sala = (await listarSalas(cookie)).items[0] as RoomBody;
    sesionesFuturas.set(sala.publicId, 3);

    const res = await app.request(`/api/v1/rooms/${sala.publicId}`, req(cookie, 'DELETE'));
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-SCHD-409-002');
    // El mensaje sin salida deja al usuario trabado: tiene que decir qué hacer.
    expect(body.error.action).toContain('archivar');
    expect((await listarSalas(cookie)).items).toHaveLength(1);
  });
});

/*
 * Una query mal escrita es error del que la escribe, no del servidor: tiene que
 * volver 422 con el código del envelope (§5.0). El 500 genérico le dice al
 * usuario "se rompió algo" cuando lo único que pasó es que el filtro está mal.
 */
describe('una query inválida vuelve 422, no 500', () => {
  it('un `limit` fuera de rango se rechaza con LP-SYS-422-006', async () => {
    const { cookie } = await nuevoCentro('rooms-query-invalida');

    const res = await app.request('/api/v1/rooms?limit=0', req(cookie, 'GET'));

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });
});

describe('aislamiento de tenant', () => {
  async function dosCentros() {
    const victima = await centroConSede('rooms-victima');
    const sala = (await listarSalas(victima.cookie)).items[0] as RoomBody;
    const atacante = await nuevoCentro('rooms-atacante');

    return { victima, atacante, salaId: sala.publicId };
  }

  it('el atacante no lee la sala del otro centro: 404, no 403', async () => {
    const { atacante, salaId } = await dosCentros();

    const res = await app.request(`/api/v1/rooms/${salaId}`, req(atacante.cookie, 'GET'));

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Principal');
  });

  it('tampoco la edita, la archiva ni la borra', async () => {
    const { atacante, salaId } = await dosCentros();

    for (const [method, path] of [
      ['PATCH', `/api/v1/rooms/${salaId}`],
      ['POST', `/api/v1/rooms/${salaId}/archive`],
      ['DELETE', `/api/v1/rooms/${salaId}`],
    ] as const) {
      const res = await app.request(
        path,
        req(atacante.cookie, method, method === 'PATCH' ? { capacity: 99 } : {}),
      );
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('no puede colgar una sala de la sede del otro centro', async () => {
    const { victima, atacante } = await dosCentros();
    const sedeAjena = (await listarSalas(victima.cookie)).items[0]?.venueId as string;

    const res = await app.request(
      '/api/v1/rooms',
      req(atacante.cookie, 'POST', { venueId: sedeAjena, name: 'Sala plantada', capacity: 10 }),
    );

    // 404 y no 403: ese Venue no existe para el atacante.
    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SCHD-404-008');
  });

  it('el listado del atacante sale vacío', async () => {
    const { atacante } = await dosCentros();

    expect((await listarSalas(atacante.cookie)).items).toEqual([]);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las siete rutas de rooms traen su fixture de ataque', () => {
    const rooms = allRegisteredRoutes().filter((route) => route.path.startsWith('/api/v1/rooms'));

    expect(rooms.length).toBe(7);
    for (const route of rooms) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('rooms-fixtures');
    const victima = await nuevoCentro('rooms-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!route.path.startsWith('/api/v1/rooms') || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        'Sala del otro centro',
      );
    }
  });

  it('cada ruta montada está declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/rooms'))
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/rooms'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });
});
