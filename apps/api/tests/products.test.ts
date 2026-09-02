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
import { VICTIM_PRODUCT_NAME } from '../src/modules/products/infrastructure/routes.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-07. El catálogo vendible (§2.1.17). Absorbe y generaliza a Packs: modelar
 * solo packs deja afuera al gimnasio y al estudio de pilates, que trabajan con
 * cuota mensual.
 *
 * Lo que se verifica y no se negocia: los siete tipos, que el dinero sea entero
 * en centavos en toda la ruta, y que archivar deje de vender sin romper nada.
 */
let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'pro' }));

const PACK = {
  name: 'Pack 8 clases',
  type: 'class_pack',
  priceCents: 6_000_000,
  credits: 8,
  durationDays: 30,
  venueIds: ['ven_centro'],
} as const;

interface ProductBody {
  publicId: string;
  name: string;
  type: string;
  priceCents: number;
  credits?: number;
  active: boolean;
  visibleInApp: boolean;
  soldCount: number;
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

/** Un socio del centro: mismo tenant, rol `member`, sin permisos de staff. */
async function socioDe(organizationId: string, nombre: string) {
  const n = ++creados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);
  const sesion = await auth.api.getSession({ headers: new Headers({ cookie }) });

  await auth.api.addMember({
    body: { userId: sesion?.user.id as string, organizationId, role: 'member' },
  });
  await app.request('/api/v1/auth/organization/set-active', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ organizationId }),
  });

  return { cookie };
}

const req = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function publicar(cookie: string, overrides: Record<string, unknown> = {}) {
  return app.request('/api/v1/products', req(cookie, 'POST', { ...PACK, ...overrides }));
}

async function publicarOk(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await publicar(cookie, overrides);
  if (res.status !== 201) throw new Error(`publicar falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as ProductBody;
}

async function catalogo(cookie: string, query = '') {
  const res = await app.request(`/api/v1/products${query}`, req(cookie, 'GET'));

  return (await res.json()) as { items: ProductBody[]; nextCursor: string | null };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_products_test' });

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
    }),
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(async () => {
  entitlements.invalidateAll();
  await mongoose.connection.db?.collection('products').deleteMany({});
});

describe('los siete tipos de §2.1.17', () => {
  const CASOS = [
    ['class_pack', { credits: 8, durationDays: 30 }],
    ['membership_unlimited', { durationDays: 30 }],
    ['membership_limited', { durationDays: 30, weeklyLimit: 3 }],
    ['drop_in', { credits: 1 }],
    ['trial', { credits: 1, priceCents: 0 }],
    ['personal_training', { credits: 4, durationDays: 60 }],
    ['event', {}],
  ] as const;

  it.each(CASOS)('publica un %s', async (type, extra) => {
    const { cookie } = await nuevoCentro(`tipo-${type}`);

    const res = await publicar(cookie, {
      name: `Producto ${type}`,
      type,
      credits: undefined,
      durationDays: undefined,
      ...extra,
    });

    const texto = await res.text();

    expect(res.status, texto).toBe(201);
    expect((JSON.parse(texto) as ProductBody).type).toBe(type);
  });

  it('sin membresía mensual el gimnasio y el pilates quedan afuera del producto', async () => {
    const { cookie } = await nuevoCentro('membresias');

    await publicar(cookie, {
      name: 'Libre mensual',
      type: 'membership_unlimited',
      priceCents: 8_500_000,
      credits: undefined,
      durationDays: 30,
    });

    const items = (await catalogo(cookie)).items;
    expect(items.map((producto) => producto.type)).toContain('membership_unlimited');
  });
});

describe('dinero', () => {
  it('el precio viaja y se guarda como entero en centavos', async () => {
    const { cookie } = await nuevoCentro('centavos');

    const publicado = await publicarOk(cookie, { priceCents: 6_000_050 });
    const enBase = await mongoose.connection.db
      ?.collection('products')
      .findOne<{ priceCents: number }>({ publicId: publicado.publicId });

    // 60.000,50 pesos son 6000050 centavos en toda la ruta: request, base y
    // respuesta. Un float en cualquiera de los tres arrastra el error a la caja.
    expect(publicado.priceCents).toBe(6_000_050);
    expect(enBase?.priceCents).toBe(6_000_050);
    expect(Number.isInteger(enBase?.priceCents)).toBe(true);
  });

  it('rechaza un precio con decimales', async () => {
    const { cookie } = await nuevoCentro('decimales');

    const res = await publicar(cookie, { priceCents: 60_000.5 });

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });
});

describe('configuración inconsistente', () => {
  it('un pack sin créditos no se publica', async () => {
    const { cookie } = await nuevoCentro('sin-creditos');

    const res = await publicar(cookie, { credits: undefined });

    expect(res.status).toBe(422);
  });

  it('una prueba paga no se publica: §2.1.17 la define gratuita', async () => {
    const { cookie } = await nuevoCentro('prueba-paga');

    const res = await publicar(cookie, {
      name: 'Prueba',
      type: 'trial',
      credits: 1,
      priceCents: 500_000,
      durationDays: undefined,
    });

    expect(res.status).toBe(422);
  });

  it('el PATCH revalida las reglas del tipo con el documento ya mezclado', async () => {
    const { cookie } = await nuevoCentro('patch-invalido');
    const pack = await publicarOk(cookie);

    const res = await app.request(
      `/api/v1/products/${pack.publicId}`,
      req(cookie, 'PATCH', { credits: null }),
    );

    // Sin revalidar con el tipo a la vista, un PATCH podria dejar el pack
    // vendible y sin clases, y eso se descubre recien al primer socio.
    expect(res.status).toBe(422);
  });

  it('el tipo no se puede cambiar por PATCH', async () => {
    const { cookie } = await nuevoCentro('patch-tipo');
    const pack = await publicarOk(cookie);

    await app.request(
      `/api/v1/products/${pack.publicId}`,
      req(cookie, 'PATCH', { type: 'membership_unlimited' }),
    );

    const res = await app.request(`/api/v1/products/${pack.publicId}`, req(cookie, 'GET'));
    // Cambiarlo cambiaria el significado de los contratos ya vendidos.
    expect(((await res.json()) as ProductBody).type).toBe('class_pack');
  });
});

describe('archivar', () => {
  it('deja de venderse pero sigue existiendo', async () => {
    const { cookie } = await nuevoCentro('archivar');
    const pack = await publicarOk(cookie);

    const archivado = await app.request(
      `/api/v1/products/${pack.publicId}/archive`,
      req(cookie, 'POST', {}),
    );

    expect(((await archivado.json()) as ProductBody).active).toBe(false);
    // El historico se preserva: los contratos vivos siguen apuntando acá.
    expect(
      (await app.request(`/api/v1/products/${pack.publicId}`, req(cookie, 'GET'))).status,
    ).toBe(200);
  });

  it('se vuelve a publicar', async () => {
    const { cookie } = await nuevoCentro('restaurar');
    const pack = await publicarOk(cookie);
    await app.request(`/api/v1/products/${pack.publicId}/archive`, req(cookie, 'POST', {}));

    const res = await app.request(
      `/api/v1/products/${pack.publicId}/restore`,
      req(cookie, 'POST', {}),
    );

    expect(((await res.json()) as ProductBody).active).toBe(true);
  });

  it('el precio nuevo no altera lo ya vendido: el contrato guarda su snapshot', async () => {
    const { cookie } = await nuevoCentro('precio');
    const pack = await publicarOk(cookie);

    await app.request(
      `/api/v1/products/${pack.publicId}`,
      req(cookie, 'PATCH', { priceCents: 7_000_000 }),
    );

    // Acá solo se verifica que el producto cambió. Que el contrato conserve su
    // `priceSnapshotCents` es de F1-08, que es quien lo escribe.
    const actualizado = (await (
      await app.request(`/api/v1/products/${pack.publicId}`, req(cookie, 'GET'))
    ).json()) as ProductBody;

    expect(actualizado.priceCents).toBe(7_000_000);
    expect(actualizado.soldCount).toBe(0);
  });
});

describe('catálogo público', () => {
  it('el socio no ve lo oculto ni lo archivado', async () => {
    const centro = await nuevoCentro('publico');
    await publicarOk(centro.cookie, { name: 'Visible' });
    await publicarOk(centro.cookie, { name: 'Oculto', visibleInApp: false });
    const archivado = await publicarOk(centro.cookie, { name: 'Archivado' });
    await app.request(
      `/api/v1/products/${archivado.publicId}/archive`,
      req(centro.cookie, 'POST', {}),
    );

    const socio = await socioDe(centro.organizationId, 'socio-catalogo');
    const visto = await catalogo(socio.cookie);

    // Ocultar un producto en el front no es una restricción: se fuerza acá.
    expect(visto.items.map((producto) => producto.name)).toEqual(['Visible']);
  });

  it('el staff ve todo, incluido lo oculto', async () => {
    const centro = await nuevoCentro('staff-ve-todo');
    await publicarOk(centro.cookie, { name: 'Visible' });
    await publicarOk(centro.cookie, { name: 'Oculto', visibleInApp: false });

    const visto = await catalogo(centro.cookie);

    expect(visto.items).toHaveLength(2);
  });

  it('el socio no puede publicar ni archivar', async () => {
    const centro = await nuevoCentro('socio-sin-permiso');
    const pack = await publicarOk(centro.cookie);
    const socio = await socioDe(centro.organizationId, 'socio-permiso');

    const publicando = await publicar(socio.cookie, { name: 'Mío' });
    const archivando = await app.request(
      `/api/v1/products/${pack.publicId}/archive`,
      req(socio.cookie, 'POST', {}),
    );

    expect(publicando.status).toBe(403);
    expect(((await publicando.json()) as ErrorBody).error.code).toBe('LP-AUTH-403-002');
    expect(archivando.status).toBe(403);
  });
});

describe('filtros', () => {
  it('filtra por tipo, sede y estado', async () => {
    const { cookie } = await nuevoCentro('filtros');
    await publicarOk(cookie, { name: 'Pack' });
    await publicarOk(cookie, {
      name: 'Libre',
      type: 'membership_unlimited',
      credits: undefined,
      durationDays: 30,
      venueIds: ['ven_otra'],
    });

    expect((await catalogo(cookie, '?type=class_pack')).items).toHaveLength(1);
    expect((await catalogo(cookie, '?venueId=ven_otra')).items).toHaveLength(1);
    expect((await catalogo(cookie, '?active=false')).items).toHaveLength(0);
  });

  it('un producto inexistente da 404 con código tipado', async () => {
    const { cookie } = await nuevoCentro('inexistente');

    const res = await app.request('/api/v1/products/prd_no_existe', req(cookie, 'GET'));

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-PROD-404-003');
  });
});

describe('aislamiento de tenant', () => {
  async function dosCentros() {
    const victima = await nuevoCentro('prod-victima');
    const pack = await publicarOk(victima.cookie, { name: 'Pack Confidencial' });
    const atacante = await nuevoCentro('prod-atacante');

    return { victima, atacante, packId: pack.publicId };
  }

  it('el atacante no ve ni edita el catálogo del otro centro', async () => {
    const { atacante, packId } = await dosCentros();

    const ver = await app.request(`/api/v1/products/${packId}`, req(atacante.cookie, 'GET'));
    const editar = await app.request(
      `/api/v1/products/${packId}`,
      req(atacante.cookie, 'PATCH', { priceCents: 1 }),
    );
    const archivar = await app.request(
      `/api/v1/products/${packId}/archive`,
      req(atacante.cookie, 'POST', {}),
    );

    expect(ver.status).toBe(404);
    expect(await ver.text()).not.toContain('Confidencial');
    expect(editar.status).toBe(404);
    expect(archivar.status).toBe(404);
  });

  it('el catálogo del atacante sale vacío', async () => {
    const { atacante } = await dosCentros();

    expect((await catalogo(atacante.cookie)).items).toEqual([]);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las seis rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter((route) =>
      route.path.startsWith('/api/v1/products'),
    );

    expect(rutas).toHaveLength(6);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('prod-fixtures');
    const victima = await nuevoCentro('prod-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!route.path.startsWith('/api/v1/products') || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(VICTIM_PRODUCT_NAME);
    }
  });

  it('cada ruta montada está declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/products'))
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/products'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });
});
