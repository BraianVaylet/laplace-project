import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import { registerRoute, resetRouteRegistry } from '../src/http/route-registry.js';
import { OPENAPI_JSON_PATH, OPENAPI_UI_PATH } from '../src/openapi/routes.js';
import { toOpenApiPath } from '../src/openapi/generate.js';
import { createLogger } from '../src/observability/logger.js';

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

const buildApp = (requireAuth = false, withAuth = false) =>
  createApp({
    logger,
    corsOrigins: [],
    ...(withAuth ? { auth } : {}),
    openapi: { version: '1.0.0', requireAuth },
  });

let replSet: MongoMemoryReplSet;
let auth: Auth;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_openapi_test' });
  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: [],
    emailSender: {
      sendVerification: () => Promise.resolve(),
      sendMagicLink: () => Promise.resolve(),
    },
    rateLimitEnabled: false,
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(() => {
  resetRouteRegistry();
});

afterEach(() => {
  resetRouteRegistry();
});

describe('la doc que sirve la API', () => {
  it('devuelve un OpenAPI valido en /api/v1/openapi.json', async () => {
    const res = await buildApp().request(OPENAPI_JSON_PATH);

    expect(res.status).toBe(200);
    const doc = (await res.json()) as Record<string, unknown>;
    expect(doc['openapi']).toBe('3.0.3');
    expect(doc['paths']).toBeDefined();
    expect(doc['components']).toBeDefined();
  });

  it('sirve Swagger UI en /api/v1/docs', async () => {
    const res = await buildApp().request(OPENAPI_UI_PATH);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('swagger');
  });

  it('refleja lo que hay registrado AHORA, no lo que habia al arrancar', async () => {
    const app = buildApp();

    const before = (await (await app.request(OPENAPI_JSON_PATH)).json()) as {
      paths: Record<string, unknown>;
    };
    expect(before.paths['/api/v1/venues']).toBeUndefined();

    registerRoute({
      method: 'GET',
      path: '/api/v1/venues',
      tenantScoped: true,
      summary: 'Listado de sedes',
      response: {
        status: 200,
        schema: z.object({ items: z.array(z.object({ name: z.string() })) }),
      },
    });

    const after = (await (await app.request(OPENAPI_JSON_PATH)).json()) as {
      paths: Record<string, unknown>;
    };
    expect(after.paths['/api/v1/venues']).toBeDefined();
  });

  it('toda ruta registrada aparece documentada: no hay endpoint sin doc', async () => {
    registerRoute({ method: 'GET', path: '/api/v1/venues', tenantScoped: true });
    registerRoute({ method: 'POST', path: '/api/v1/venues', tenantScoped: true });
    registerRoute({ method: 'GET', path: '/api/v1/venues/:id', tenantScoped: true });

    const doc = (await (await buildApp().request(OPENAPI_JSON_PATH)).json()) as {
      paths: Record<string, Record<string, unknown>>;
    };

    for (const [method, path] of [
      ['get', '/api/v1/venues'],
      ['post', '/api/v1/venues'],
      ['get', '/api/v1/venues/:id'],
    ] as const) {
      expect(doc.paths[toOpenApiPath(path)]?.[method], `${method} ${path}`).toBeDefined();
    }
  });

  it('en produccion la doc pide sesion: el mapa de la API no es publico', async () => {
    const app = buildApp(true, true);

    const json = await app.request(OPENAPI_JSON_PATH);
    expect(json.status).toBe(401);
    expect(await json.text()).not.toContain('"openapi"');

    expect((await app.request(OPENAPI_UI_PATH)).status).toBe(401);
  });

  it('en dev se sirve sin sesion: pedirla ahi solo estorba', async () => {
    const app = buildApp(false, true);

    expect((await app.request(OPENAPI_JSON_PATH)).status).toBe(200);
  });

  it('sin la opcion openapi, la app no expone la doc', async () => {
    const app = createApp({ logger, corsOrigins: [] });

    expect((await app.request(OPENAPI_JSON_PATH)).status).toBe(404);
  });
});
