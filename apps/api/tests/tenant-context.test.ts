import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Schema, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Hono } from 'hono';
import { createApp, type AppEnv } from '../src/app.js';
import { currentTenant, runWithTenant } from '../src/tenancy/context.js';
import { tenantContext } from '../src/tenancy/middleware.js';
import { baseFieldsPlugin, tenantPlugin } from '../src/tenancy/plugin.js';
import { TenantRepository } from '../src/tenancy/repository.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F0-04, capa 0: el middleware que abre el contexto.
 *
 * Es la pieza mas sensible del backend. El `tenantId` sale de la organizacion
 * activa de la SESION (ADR-000 regla 2) y de ningun otro lado; si aceptara uno
 * del body o de la query, cualquier endpoint seria un pase libre a los datos de
 * otro centro.
 */
let replSet: MongoMemoryReplSet;

const BOX_TORO = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const GYM_BLACK = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

interface ThingDoc extends Record<string, unknown> {
  name: string;
}

const thingSchema = new Schema<ThingDoc>({ name: { type: String, required: true } });
thingSchema.plugin(tenantPlugin);
thingSchema.plugin(baseFieldsPlugin);

let Thing: Model<ThingDoc>;

class ThingRepository extends TenantRepository<ThingDoc> {
  constructor(model: Model<ThingDoc>) {
    super(model, 'member');
  }
}
let things: ThingRepository;

/** Organizacion activa simulada: es lo que en produccion pone `requireOrganization`. */
let activeOrg = BOX_TORO;

function buildApp() {
  const probes = new Hono<AppEnv>();

  // La organizacion activa viaja por header solo en este test, para poder
  // solapar dos pedidos de centros distintos. En produccion la pone
  // `requireOrganization` leyendo la sesion, nunca un header del cliente.
  probes.use('*', async (c, next) => {
    const organizationId = c.req.header('x-test-org') ?? activeOrg;
    c.set('org', { organizationId, memberId: 'mbr_1', roles: ['owner'] });
    c.set('userId', 'usr_braian');
    await next();
  });
  probes.use('*', tenantContext);

  probes.get('/probe/context', (c) => c.json(currentTenant() ?? {}));
  probes.get('/probe/things', async (c) => c.json(await things.list()));
  probes.post('/probe/things', async (c) => {
    const body = (await c.req.json()) as { name: string };
    return c.json(await things.create({ name: body.name }));
  });

  return createApp({ logger, corsOrigins: [], extraRoutes: probes });
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_tenantctx_test' });
  Thing = mongoose.model<ThingDoc>('Thing', thingSchema);
  things = new ThingRepository(Thing);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  activeOrg = BOX_TORO;
  await mongoose.connection.db?.collection('things').deleteMany({});
});

describe('el contexto que abre el middleware', () => {
  it('expone tenantId, userId y requestId', async () => {
    const res = await buildApp().request('/probe/context', {
      headers: { 'x-request-id': 'req-abc' },
    });

    expect(await res.json()).toEqual({
      tenantId: BOX_TORO,
      userId: 'usr_braian',
      requestId: 'req-abc',
    });
  });

  it('el tenantId es el de la organizacion activa de la sesion', async () => {
    activeOrg = GYM_BLACK;

    const body = (await (await buildApp().request('/probe/context')).json()) as {
      tenantId: string;
    };

    expect(body.tenantId).toBe(GYM_BLACK);
  });

  it('el contexto se cierra al terminar el pedido: no se filtra al siguiente', async () => {
    await buildApp().request('/probe/context');

    expect(currentTenant()).toBeUndefined();
  });
});

describe('lo que el cliente diga sobre el tenant no se lee nunca', () => {
  it('un tenantId en la query se ignora', async () => {
    const res = await buildApp().request(`/probe/context?tenantId=${GYM_BLACK}`);

    expect(((await res.json()) as { tenantId: string }).tenantId).toBe(BOX_TORO);
  });

  it('un tenantId en el body se ignora', async () => {
    const app = buildApp();
    await app.request('/probe/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Rack 1', tenantId: GYM_BLACK }),
    });

    const raw = await mongoose.connection.db?.collection('things').findOne({ name: 'Rack 1' });
    expect(raw?.['tenantId']).toBe(BOX_TORO);
  });

  it('un header con otro tenant tampoco cambia nada', async () => {
    const res = await buildApp().request('/probe/context', {
      headers: { 'x-tenant-id': GYM_BLACK, 'x-organization-id': GYM_BLACK },
    });

    expect(((await res.json()) as { tenantId: string }).tenantId).toBe(BOX_TORO);
  });
});

describe('de punta a punta: middleware, repositorio y aislamiento', () => {
  it('lo creado en un pedido queda con el tenant de ese pedido', async () => {
    const app = buildApp();

    await app.request('/probe/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'de Box Toro' }),
    });

    activeOrg = GYM_BLACK;
    await app.request('/probe/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'de Gym Black' }),
    });

    activeOrg = BOX_TORO;
    const mine = (await (await app.request('/probe/things')).json()) as { items: ThingDoc[] };

    expect(mine.items.map((i) => i.name)).toEqual(['de Box Toro']);
  });

  it('dos pedidos concurrentes de centros distintos no se pisan', async () => {
    const app = buildApp();

    // El contexto vive en AsyncLocalStorage: cada pedido tiene el suyo aunque
    // se solapen en el tiempo.
    const ask = async (org: string) => {
      const res = await app.request('/probe/context', { headers: { 'x-test-org': org } });
      return (await res.json()) as { tenantId: string };
    };

    const [uno, dos] = await Promise.all([ask(BOX_TORO), ask(GYM_BLACK)]);

    expect(uno.tenantId).toBe(BOX_TORO);
    expect(dos.tenantId).toBe(GYM_BLACK);
  });
});

describe('alta masiva', () => {
  it('todo lo importado queda del centro activo, con su id publico', async () => {
    await runWithTenant(
      { tenantId: BOX_TORO, userId: 'usr_braian', requestId: 'req-csv' },
      async () => {
        await things.createMany([{ name: 'fila 1' }, { name: 'fila 2' }, { name: 'fila 3' }]);
      },
    );

    const docs = await mongoose.connection.db?.collection('things').find({}).toArray();
    expect(docs).toHaveLength(3);
    for (const doc of docs ?? []) {
      expect(doc['tenantId']).toBe(BOX_TORO);
      expect(doc['createdBy']).toBe('usr_braian');
      expect(String(doc['publicId'])).toMatch(/^mem_/);
    }
  });

  it('importar cero filas no rompe ni escribe nada', async () => {
    const inserted = await runWithTenant(
      { tenantId: BOX_TORO, userId: 'usr_braian', requestId: 'req-csv' },
      () => things.createMany([]),
    );

    expect(inserted).toBe(0);
  });

  it('sin contexto, el alta masiva falla en vez de crear documentos huerfanos', async () => {
    await expect(Thing.insertMany([{ name: 'huerfano' }] as never)).rejects.toThrow();

    expect(await mongoose.connection.db?.collection('things').countDocuments()).toBe(0);
  });
});
