import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Schema, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Hono } from 'hono';
import { createApp, type AppEnv } from '../src/app.js';
import {
  allRegisteredRoutes,
  registerRoute,
  requiresRegistration,
  resetRouteRegistry,
  type IsolationAttack,
} from '../src/http/route-registry.js';
import { runWithTenant } from '../src/tenancy/context.js';
import { baseFieldsPlugin, tenantPlugin } from '../src/tenancy/plugin.js';
import { TenantRepository } from '../src/tenancy/repository.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F0-05. El test que la spec §Testing declara **no negociable**: para cada ruta
 * de negocio registrada, el tenant A no puede leer ni escribir recursos del
 * tenant B, ni siquiera con un ID valido en la mano.
 *
 * Se parametriza sobre el registro de rutas para que un endpoint nuevo entre
 * solo. Sumar la ruta sin sumar su fixture rompe el CI.
 */
let replSet: MongoMemoryReplSet;

const VICTIM = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ATTACKER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

interface NoteDoc extends Record<string, unknown> {
  text: string;
}

const noteSchema = new Schema<NoteDoc>({ text: { type: String, required: true } });
noteSchema.plugin(tenantPlugin);
noteSchema.plugin(baseFieldsPlugin);

let Note: Model<NoteDoc>;

class NoteRepository extends TenantRepository<NoteDoc> {
  constructor(model: Model<NoteDoc>) {
    super(model, 'member');
  }
}
let notes: NoteRepository;

/**
 * Rutas de negocio de prueba, escritas como se deben escribir las de verdad:
 * todo pasa por el repositorio y el tenant sale del contexto.
 */
function businessRoutes(tenantIdOf: () => string) {
  const withTenant =
    <T>(fn: () => Promise<T>) =>
    () =>
      runWithTenant({ tenantId: tenantIdOf(), userId: 'usr_test', requestId: 'req-test' }, fn);

  return new Hono<AppEnv>()
    .get('/api/v1/notes/:id', async (c) => {
      const note = await withTenant(() => notes.findByPublicId(c.req.param('id')))();
      return note ? c.json(note) : c.json({ success: false }, 404);
    })
    .patch('/api/v1/notes/:id', async (c) => {
      const updated = await withTenant(() =>
        notes.updateByPublicId(c.req.param('id'), { $set: { text: 'tocado' } }),
      )();
      return updated ? c.json(updated) : c.json({ success: false }, 404);
    })
    .delete('/api/v1/notes/:id', async (c) => {
      const ok = await withTenant(() => notes.softDeleteByPublicId(c.req.param('id')))();
      return ok ? c.json({ ok: true }) : c.json({ success: false }, 404);
    })
    .get('/api/v1/notes', async (c) => c.json(await withTenant(() => notes.list())()));
}

/** La ruta trampa: consulta el modelo directo, sin repositorio. Debe hacer fallar la suite. */
function trapRoute(tenantIdOf: () => string) {
  return new Hono<AppEnv>().get('/api/v1/trap/:id', async (c) =>
    runWithTenant(
      { tenantId: tenantIdOf(), userId: 'usr_test', requestId: 'req-test' },
      async () => {
        const raw = await mongoose.connection.db
          ?.collection('notes')
          .findOne({ publicId: c.req.param('id') });
        return raw ? c.json(raw) : c.json({ success: false }, 404);
      },
    ),
  );
}

let actingTenant = ATTACKER;
const tenantIdOf = () => actingTenant;

async function seedVictimNote(): Promise<string> {
  const note = await runWithTenant(
    { tenantId: VICTIM, userId: 'usr_victima', requestId: 'req-seed' },
    () => notes.create({ text: 'secreto del otro centro' }),
  );
  return String(note['publicId']);
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_isolation_test' });
  Note = mongoose.model<NoteDoc>('Note', noteSchema);
  notes = new NoteRepository(Note);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  resetRouteRegistry();
  actingTenant = ATTACKER;
  await mongoose.connection.db?.collection('notes').deleteMany({});
});

afterEach(() => {
  resetRouteRegistry();
});

/** Declara las rutas de negocio en el registro, con su fixture de ataque. */
function registerBusinessRoutes(): void {
  const seed = async (): Promise<IsolationAttack> => ({
    path: `/api/v1/notes/${await seedVictimNote()}`,
  });

  registerRoute({
    method: 'GET',
    path: '/api/v1/notes/:id',
    tenantScoped: true,
    isolationFixture: seed,
  });
  registerRoute({
    method: 'PATCH',
    path: '/api/v1/notes/:id',
    tenantScoped: true,
    isolationFixture: seed,
  });
  registerRoute({
    method: 'DELETE',
    path: '/api/v1/notes/:id',
    tenantScoped: true,
    isolationFixture: seed,
  });
  registerRoute({
    method: 'GET',
    path: '/api/v1/notes',
    tenantScoped: true,
    isolationFixture: async () => {
      await seedVictimNote();
      return { path: '/api/v1/notes' };
    },
  });
}

describe('el registro cubre todas las rutas de negocio', () => {
  it('una ruta bajo /api/v1 sin registrar hace fallar la suite', () => {
    registerBusinessRoutes();
    const app = createApp({
      logger,
      corsOrigins: [],
      extraRoutes: businessRoutes(tenantIdOf).route('/', trapRoute(tenantIdOf)),
    });

    const unregistered = app.routes
      .filter((r) => requiresRegistration(r.path))
      .filter((r) => r.method !== 'ALL')
      .filter(
        (r) =>
          !allRegisteredRoutes().some((spec) => spec.method === r.method && spec.path === r.path),
      )
      .map((r) => `${r.method} ${r.path}`);

    // `/api/v1/trap/:id` existe en la app pero nadie la registro: eso es
    // exactamente lo que este chequeo tiene que cazar.
    expect(unregistered).toContain('GET /api/v1/trap/:id');
  });

  it('con todo registrado, no queda ninguna ruta suelta', () => {
    registerBusinessRoutes();
    const app = createApp({ logger, corsOrigins: [], extraRoutes: businessRoutes(tenantIdOf) });

    const unregistered = app.routes
      .filter((r) => requiresRegistration(r.path))
      .filter((r) => r.method !== 'ALL')
      .filter(
        (r) =>
          !allRegisteredRoutes().some((spec) => spec.method === r.method && spec.path === r.path),
      )
      .map((r) => `${r.method} ${r.path}`);

    expect(unregistered).toEqual([]);
  });

  it('las rutas de Better Auth y la doc no necesitan registro', () => {
    expect(requiresRegistration('/api/v1/auth/sign-in/email')).toBe(false);
    expect(requiresRegistration('/api/v1/docs')).toBe(false);
    expect(requiresRegistration('/health')).toBe(false);
    expect(requiresRegistration('/api/v1/members/:id')).toBe(true);
  });

  it('toda ruta registrada como tenantScoped trae su fixture de ataque', () => {
    registerBusinessRoutes();

    const sinFixture = allRegisteredRoutes()
      .filter((spec) => spec.tenantScoped && !spec.isolationFixture)
      .map((spec) => `${spec.method} ${spec.path}`);

    expect(sinFixture).toEqual([]);
  });
});

describe('la app real', () => {
  it('no tiene ninguna ruta de negocio sin registrar', async () => {
    // Importa el registro de rutas real, el que van a poblar los modulos de
    // Fase 1. Hoy esta vacio y el chequeo pasa solo; el dia que alguien agregue
    // `POST /api/v1/members` sin registrarla, este test la caza.
    const { createApp: realApp } = await import('../src/app.js');
    const app = realApp({ logger, corsOrigins: [] });

    const unregistered = app.routes
      .filter((r) => requiresRegistration(r.path))
      .filter((r) => r.method !== 'ALL')
      .filter(
        (r) =>
          !allRegisteredRoutes().some((spec) => spec.method === r.method && spec.path === r.path),
      )
      .map((r) => `${r.method} ${r.path}`);

    expect(unregistered).toEqual([]);
  });
});

describe('ataque cruzado, ruta por ruta', () => {
  async function attackAll(app: ReturnType<typeof createApp>) {
    const results: Array<{ route: string; status: number; body: string }> = [];

    for (const spec of allRegisteredRoutes()) {
      if (!spec.tenantScoped || !spec.isolationFixture) continue;

      const attack = await spec.isolationFixture({ victimTenantId: VICTIM });
      const res = await app.request(attack.path, {
        method: spec.method,
        ...(attack.body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(attack.body) }),
      });

      results.push({
        route: `${spec.method} ${spec.path}`,
        status: res.status,
        body: await res.text(),
      });
    }

    return results;
  }

  it('el tenant A no ve ni toca ningun recurso del tenant B', async () => {
    registerBusinessRoutes();
    const app = createApp({ logger, corsOrigins: [], extraRoutes: businessRoutes(tenantIdOf) });

    const results = await attackAll(app);

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.body, result.route).not.toContain('secreto del otro centro');
    }
  });

  it('responde 404 y no 403: un 403 confirmaria que el recurso existe', async () => {
    registerBusinessRoutes();
    const app = createApp({ logger, corsOrigins: [], extraRoutes: businessRoutes(tenantIdOf) });

    const results = (await attackAll(app)).filter((r) => r.route.includes(':id'));

    for (const result of results) {
      expect(result.status, result.route).toBe(404);
    }
  });

  it('el listado del atacante sale vacio, no con lo del otro', async () => {
    registerBusinessRoutes();
    const app = createApp({ logger, corsOrigins: [], extraRoutes: businessRoutes(tenantIdOf) });
    await seedVictimNote();

    const res = await app.request('/api/v1/notes');
    const body = (await res.json()) as { items: unknown[] };

    expect(body.items).toEqual([]);
  });

  it('el dueño legitimo si accede: el aislamiento no rompe el camino feliz', async () => {
    registerBusinessRoutes();
    const app = createApp({ logger, corsOrigins: [], extraRoutes: businessRoutes(tenantIdOf) });
    const id = await seedVictimNote();

    actingTenant = VICTIM;
    const res = await app.request(`/api/v1/notes/${id}`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('secreto del otro centro');
  });
});

describe('caso trampa: la suite tiene que poder fallar', () => {
  it('una ruta que consulta el modelo directo, sin repositorio, SI filtra datos del otro centro', async () => {
    const app = createApp({ logger, corsOrigins: [], extraRoutes: trapRoute(tenantIdOf) });
    const id = await seedVictimNote();

    const res = await app.request(`/api/v1/trap/${id}`);

    // Este es el bug que la suite existe para cazar: sin repositorio y sin
    // plugin, el driver crudo devuelve el documento del otro centro.
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('secreto del otro centro');
  });
});
