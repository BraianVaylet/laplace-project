import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import type { OrganizationEntitlementSource } from '../src/entitlements/entitlements.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModuleRoutes } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-01. El CRUD de sedes de punta a punta, contra Mongo real y con sesiones de
 * Better Auth: es la primera ruta de negocio del producto y la que fija el
 * patron para las otras 31 tareas de la fase.
 *
 * Lo que se verifica y no se negocia: aislamiento de tenant, limite del plan y
 * que archivar libere el cupo.
 */
let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};

/** El plan de cada organizacion, para poder mover el limite dentro del test. */
const planPorOrg = new Map<string, OrganizationEntitlementSource>();
const entitlements = createEntitlementsLoader((organizationId) =>
  Promise.resolve(planPorOrg.get(organizationId) ?? { planId: 'basic' }),
);

const SEDE = {
  name: 'Box Toro Centro',
  address: 'Alsina 123, Bahía Blanca',
  phone: '+5492914000000',
  timeZone: 'America/Argentina/Buenos_Aires',
} as const;

interface VenueBody {
  publicId: string;
  name: string;
  status: string;
  tenantId?: string;
  bookingPolicy: Record<string, number | boolean>;
}
type ErrorBody = { success: false; error: { code: string; message: string } };

async function signUp(email: string): Promise<string> {
  const res = await app.request('/api/v1/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'unaClaveLargaYSegura123', name: email.split('@')[0] }),
  });
  const raw = res.headers.get('set-cookie');
  if (!raw) {
    throw new Error(`el registro de ${email} fallo: ${res.status} ${await res.text()}`);
  }

  return raw
    .split(/,(?=[^;]+?=)/)
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function createOrganization(cookie: string, name: string, slug: string): Promise<string> {
  const res = await app.request('/api/v1/auth/organization/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name, slug }),
  });
  if (res.status !== 200) throw new Error(`create org fallo: ${res.status} ${await res.text()}`);

  const org = (await res.json()) as { id: string };
  await app.request('/api/v1/auth/organization/set-active', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ organizationId: org.id }),
  });

  return org.id;
}

/**
 * Un centro listo para operar: usuario registrado, organizacion creada y activa.
 *
 * El email y el slug llevan un correlativo porque los usuarios y las
 * organizaciones no se borran entre tests: reusarlos haria fallar el alta por
 * duplicado y el error se leeria como un bug del modulo.
 */
let centrosCreados = 0;
async function nuevoCentro(nombre: string) {
  const n = ++centrosCreados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);
  const organizationId = await createOrganization(
    cookie,
    `Centro ${nombre} ${n}`,
    `${nombre}-${n}`,
  );

  return { cookie, organizationId };
}

const json = (cookie: string, body?: unknown) => ({
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'content-type': 'application/json', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function crearSede(cookie: string, overrides: Record<string, unknown> = {}) {
  return app.request('/api/v1/venues', json(cookie, { ...SEDE, ...overrides }));
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_venues_test' });

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5174'],
    emailSender,
    // El rate limit de F0-03 tiene su propia suite. Aca cada caso da de alta un
    // centro, y con el prendido el test mediria el limite en vez del modulo.
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
    }),
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  planPorOrg.clear();
  entitlements.invalidateAll();
  await mongoose.connection.db?.collection('venues').deleteMany({});
});

describe('alta de sede', () => {
  it('crea la sede con los datos del formulario', async () => {
    const { cookie } = await nuevoCentro('alta');

    const res = await crearSede(cookie);
    const body = (await res.json()) as VenueBody;

    expect(res.status).toBe(201);
    expect(body.name).toBe('Box Toro Centro');
    expect(body.status).toBe('active');
    expect(body.publicId).toBeTruthy();
  });

  it('completa la politica de reserva con los defaults de §2.1.5.c', async () => {
    const { cookie } = await nuevoCentro('defaults');

    const body = (await (await crearSede(cookie)).json()) as VenueBody;

    // Una sede sin ventanas de reserva no puede recibir una reserva, y eso se
    // descubriria recien con el primer socio que lo intente.
    expect(body.bookingPolicy['cancelCutoffMinutes']).toBe(120);
    expect(body.bookingPolicy['bookingOpensMinutesBefore']).toBe(7 * 24 * 60);
    expect(body.bookingPolicy['allowDebt']).toBe(false);
  });

  it('rechaza una politica incoherente con LP-SCHD-422-001, no con el generico', async () => {
    const { cookie } = await nuevoCentro('politica');

    const res = await crearSede(cookie, {
      bookingPolicy: { bookingOpensMinutesBefore: 60, bookingClosesMinutesBefore: 120 },
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SCHD-422-001');
    expect(body.error.message).toContain('apertura');
  });

  it('rechaza el resto de los datos invalidos con el codigo de payload', async () => {
    const { cookie } = await nuevoCentro('payload');

    const res = await crearSede(cookie, { timeZone: 'America/Inventada' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SYS-422-006');
    expect(body.error.message).toContain('timeZone');
  });

  it('sin sesion no se crea nada', async () => {
    const res = await app.request('/api/v1/venues', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SEDE),
    });

    expect(res.status).toBe(401);
  });
});

describe('lectura y edicion', () => {
  it('devuelve la sede por su publicId', async () => {
    const { cookie } = await nuevoCentro('lectura');
    const creada = (await (await crearSede(cookie)).json()) as VenueBody;

    const res = await app.request(`/api/v1/venues/${creada.publicId}`, json(cookie));

    expect(res.status).toBe(200);
    expect(((await res.json()) as VenueBody).publicId).toBe(creada.publicId);
  });

  it('un publicId inexistente da 404 con codigo tipado', async () => {
    const { cookie } = await nuevoCentro('inexistente');

    const res = await app.request('/api/v1/venues/ven_no_existe', json(cookie));

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-404-002');
  });

  it('el PATCH cambia solo lo que le mandan', async () => {
    const { cookie } = await nuevoCentro('patch');
    const creada = (await (await crearSede(cookie)).json()) as VenueBody;

    const res = await app.request(`/api/v1/venues/${creada.publicId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'Box Toro Norte' }),
    });
    const body = (await res.json()) as VenueBody;

    expect(res.status).toBe(200);
    expect(body.name).toBe('Box Toro Norte');
    // La politica no se toca si no la mandaron.
    expect(body.bookingPolicy['cancelCutoffMinutes']).toBe(120);
  });

  it('el listado pagina por cursor y trae solo las del centro', async () => {
    const { cookie } = await nuevoCentro('listado');
    planPorOrg.clear();
    await crearSede(cookie);

    const res = await app.request('/api/v1/venues', json(cookie));
    const body = (await res.json()) as { items: VenueBody[]; nextCursor: string | null };

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe('Box Toro Centro');
  });
});

describe('archivar y reactivar', () => {
  it('archivar no borra: preserva el historico (§2.1.6)', async () => {
    const { cookie } = await nuevoCentro('archivar');
    const creada = (await (await crearSede(cookie)).json()) as VenueBody;

    const res = await app.request(`/api/v1/venues/${creada.publicId}/archive`, json(cookie, {}));

    expect(res.status).toBe(200);
    expect(((await res.json()) as VenueBody).status).toBe('archived');
    expect((await app.request(`/api/v1/venues/${creada.publicId}`, json(cookie))).status).toBe(200);
  });

  it('reactivar la devuelve a activa', async () => {
    const { cookie } = await nuevoCentro('reactivar');
    const creada = (await (await crearSede(cookie)).json()) as VenueBody;
    await app.request(`/api/v1/venues/${creada.publicId}/archive`, json(cookie, {}));

    const res = await app.request(`/api/v1/venues/${creada.publicId}/restore`, json(cookie, {}));

    expect(res.status).toBe(200);
    expect(((await res.json()) as VenueBody).status).toBe('active');
  });

  it('archivar dos veces es una transicion invalida, no un no-op silencioso', async () => {
    const { cookie } = await nuevoCentro('doble');
    const creada = (await (await crearSede(cookie)).json()) as VenueBody;
    await app.request(`/api/v1/venues/${creada.publicId}/archive`, json(cookie, {}));

    const res = await app.request(`/api/v1/venues/${creada.publicId}/archive`, json(cookie, {}));
    const body = (await res.json()) as ErrorBody;

    // §14: los estados cambian solo por transicion explicita y validada.
    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-SCHD-422-006');
  });
});

describe('limite del plan', () => {
  it('el centro Basic no puede crear la segunda sede', async () => {
    const { cookie } = await nuevoCentro('limite');
    expect((await crearSede(cookie)).status).toBe(201);

    const res = await crearSede(cookie, { name: 'Box Toro Sur' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-ENTL-403-001');
    // El mensaje dice cuanto es el maximo: un limite sin numero no se entiende.
    expect(body.error.message).toContain('1');
  });

  it('el limite corta ANTES de escribir: no queda una sede a medias', async () => {
    const { cookie } = await nuevoCentro('sin-huecos');
    await crearSede(cookie);

    await crearSede(cookie, { name: 'Box Toro Sur' });
    const listado = (await (await app.request('/api/v1/venues', json(cookie))).json()) as {
      items: VenueBody[];
    };

    expect(listado.items).toHaveLength(1);
  });

  it('archivar libera el cupo: cerrar una sede no puede seguir costando plata', async () => {
    const { cookie } = await nuevoCentro('libera');
    const creada = (await (await crearSede(cookie)).json()) as VenueBody;
    await app.request(`/api/v1/venues/${creada.publicId}/archive`, json(cookie, {}));

    const res = await crearSede(cookie, { name: 'Box Toro Sur' });

    expect(res.status).toBe(201);
  });

  it('un plan con mas cupo deja crear mas sedes', async () => {
    const { cookie, organizationId } = await nuevoCentro('pro');
    planPorOrg.set(organizationId, { planId: 'pro' });
    entitlements.invalidateAll();

    expect((await crearSede(cookie)).status).toBe(201);
    expect((await crearSede(cookie, { name: 'Box Toro Sur' })).status).toBe(201);
  });
});

describe('aislamiento de tenant', () => {
  /** Dos centros distintos, cada uno con su sede. */
  async function dosCentros() {
    const victima = await nuevoCentro('victima');
    const sede = (await (await crearSede(victima.cookie)).json()) as VenueBody;
    const atacante = await nuevoCentro('atacante');

    return { victima, atacante, sedeId: sede.publicId };
  }

  it('el atacante no lee la sede del otro centro, y recibe 404 y no 403', async () => {
    const { atacante, sedeId } = await dosCentros();

    const res = await app.request(`/api/v1/venues/${sedeId}`, json(atacante.cookie));

    // 403 confirmaria que el recurso existe. 404 no dice nada.
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Box Toro Centro');
  });

  it('tampoco la edita ni la archiva', async () => {
    const { atacante, sedeId } = await dosCentros();

    const patch = await app.request(`/api/v1/venues/${sedeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: atacante.cookie },
      body: JSON.stringify({ name: 'Tomada' }),
    });
    const archive = await app.request(
      `/api/v1/venues/${sedeId}/archive`,
      json(atacante.cookie, {}),
    );

    expect(patch.status).toBe(404);
    expect(archive.status).toBe(404);
  });

  it('el listado del atacante sale vacio, no con lo del otro centro', async () => {
    const { atacante } = await dosCentros();

    const body = (await (await app.request('/api/v1/venues', json(atacante.cookie))).json()) as {
      items: VenueBody[];
    };

    expect(body.items).toEqual([]);
  });

  it('un tenantId plantado en el body se ignora por completo', async () => {
    const { victima, atacante } = await dosCentros();

    const res = await crearSede(atacante.cookie, {
      name: 'Sede plantada',
      tenantId: victima.organizationId,
    });
    const creada = (await res.json()) as VenueBody;

    // ADR-000 regla 2: el tenantId sale de la sesion, nunca del body.
    const enBase = await mongoose.connection.db
      ?.collection('venues')
      .findOne<{ tenantId: string }>({ publicId: creada.publicId });

    expect(res.status).toBe(201);
    expect(enBase?.tenantId).toBe(atacante.organizationId);
    expect(enBase?.tenantId).not.toBe(victima.organizationId);
  });

  it('la victima sigue viendo lo suyo: el aislamiento no rompe el camino feliz', async () => {
    const { victima, sedeId } = await dosCentros();

    const res = await app.request(`/api/v1/venues/${sedeId}`, json(victima.cookie));

    expect(res.status).toBe(200);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('todas las rutas de venues traen su fixture de ataque', () => {
    const venues = allRegisteredRoutes().filter((route) => route.path.startsWith('/api/v1/venues'));

    expect(venues.length).toBe(6);
    for (const route of venues) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('fixtures');
    const victima = await nuevoCentro('fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!route.path.startsWith('/api/v1/venues') || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        'Sede del otro centro',
      );
    }
  });
});

describe('el registro no deja rutas de venues sueltas', () => {
  it('cada ruta montada esta declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/venues'))
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/venues'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });
});

afterAll(() => {
  resetRouteRegistry();
});
