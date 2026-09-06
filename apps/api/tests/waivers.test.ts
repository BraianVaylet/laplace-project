import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { LegalDocument, PendingDocument } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { runWithTenant } from '../src/tenancy/context.js';
import { VICTIM_DOCUMENT_TITLE } from '../src/modules/waivers/infrastructure/routes.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-20. Es riesgo legal, no una funcionalidad opcional (§2.1.20): un centro
 * tiene que poder probar exactamente qué firmó cada socio, y un menor no
 * puede entrenar sin el consentimiento de su tutor.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260904090000-waivers-unique.cjs'),
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

type Centro = { cookie: string; organizationId: string; venueId: string };

/** Un centro con sede (para poder crear socios con `venueIds`). */
async function centroListo(nombre: string): Promise<Centro> {
  const centro = await nuevoCentro(nombre);
  const sede = await post<{ publicId: string }>(centro.cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  return { ...centro, venueId: sede.publicId };
}

/** Un socio con sesión propia: canjea un código de invitación y queda ligado a su ficha. */
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

async function publicar(centro: Centro, overrides: Record<string, unknown> = {}) {
  return post<LegalDocument>(centro.cookie, '/api/v1/legal-documents', {
    type: 'liability_waiver',
    title: 'Deslinde de responsabilidad',
    contentHtml: '<p>Firmo que entreno bajo mi propia responsabilidad.</p>',
    required: true,
    ...overrides,
  });
}

const pendientes = async (cookie: string) => {
  const res = await app.request('/api/v1/legal-documents/pending', req(cookie, 'GET'));

  return { res, body: (await res.json()) as PendingDocument[] };
};

const aceptar = (cookie: string, documentId: string) =>
  app.request(`/api/v1/legal-documents/${documentId}/accept`, req(cookie, 'POST', {}));

const cumplimiento = async (centro: Centro, documentId: string) => {
  const res = await app.request(
    `/api/v1/legal-documents/${documentId}/compliance`,
    req(centro.cookie, 'GET'),
  );

  return { res, body: await res.json() };
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_waivers_test' });
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
  for (const coleccion of ['members', 'venues', 'legalDocuments', 'consents']) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('publicar un documento (§2.1.20)', () => {
  it('queda versionado con su contenido, su fecha y si es obligatorio', async () => {
    const centro = await centroListo('publicar');

    const doc = await publicar(centro);

    expect(doc.version).toBe(1);
    expect(doc.required).toBe(true);
    expect(doc.publishedAt).toBeTruthy();
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('publicar el mismo tipo de nuevo suma versión', async () => {
    const centro = await centroListo('version-suma');
    await publicar(centro);

    const v2 = await publicar(centro, { contentHtml: '<p>Versión 2.</p>' });

    expect(v2.version).toBe(2);
  });

  it('sin permiso de staff, no publica', async () => {
    const centro = await centroListo('publicar-sin-permiso');
    const socio = await atletaDe(centro, 'Micaela');

    const res = await app.request(
      '/api/v1/legal-documents',
      req(socio.cookie, 'POST', {
        type: 'terms',
        title: 'Términos',
        contentHtml: '<p>x</p>',
      }),
    );

    expect(res.status).toBe(403);
  });

  it('el consentimiento del tutor se publica siempre obligatorio, aunque se pida lo contrario', async () => {
    const centro = await centroListo('tutor-forzado');

    const doc = await publicar(centro, { type: 'guardian_consent', required: false });

    expect(doc.required).toBe(true);
  });
});

describe('lo que el socio ve pendiente', () => {
  it('un documento opcional no aparece', async () => {
    const centro = await centroListo('pendientes-opcional');
    await publicar(centro, { type: 'image_consent', required: false });
    const socio = await atletaDe(centro, 'Micaela');

    const { body } = await pendientes(socio.cookie);

    expect(body).toHaveLength(0);
  });

  it('un documento obligatorio aparece sin firmar', async () => {
    const centro = await centroListo('pendientes-obligatorio');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');

    const { body } = await pendientes(socio.cookie);

    expect(body).toHaveLength(1);
    expect(body[0]?.publicId).toBe(doc.publicId);
    expect(body[0]?.accepted).toBe(false);
  });

  it('después de firmarlo, aparece como aceptado', async () => {
    const centro = await centroListo('pendientes-firmado');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');
    await aceptar(socio.cookie, doc.publicId);

    const { body } = await pendientes(socio.cookie);

    expect(body[0]?.accepted).toBe(true);
  });

  it('el consentimiento del tutor no aparece para un adulto', async () => {
    const centro = await centroListo('tutor-adulto');
    await publicar(centro, { type: 'guardian_consent', required: true });
    const socio = await atletaDe(centro, 'Adulto');
    // El canje no pide fecha de nacimiento (es autoservicio); el staff la
    // carga después, editando la ficha.
    await app.request(
      `/api/v1/members/${socio.memberId}`,
      req(centro.cookie, 'PATCH', { birthDate: '1990-01-01' }),
    );

    const { body } = await pendientes(socio.cookie);

    expect(body).toHaveLength(0);
  });

  it('🔴 el consentimiento del tutor sí aparece para un menor', async () => {
    const centro = await centroListo('tutor-menor');
    await publicar(centro, { type: 'guardian_consent', required: true });
    const socio = await atletaDe(centro, 'Menor');
    await app.request(
      `/api/v1/members/${socio.memberId}`,
      req(centro.cookie, 'PATCH', {
        birthDate: '2015-01-01',
        guardian: { fullName: 'Su Tutor', phone: '2911234567' },
      }),
    );

    const { body } = await pendientes(socio.cookie);

    expect(body).toHaveLength(1);
    expect(body[0]?.type).toBe('guardian_consent');
  });

  it('sin ficha de socio, la lista sale vacía y no un error', async () => {
    const centro = await centroListo('pendientes-sin-ficha');
    await publicar(centro);
    const cookie = await signUp(`sin-ficha-${++creados}@laplace.test`);
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

    const { res, body } = await pendientes(cookie);

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe('aceptar un documento', () => {
  it('registra timestamp, ip, user agent y el hash de esa versión', async () => {
    const centro = await centroListo('aceptar-completo');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');

    const res = await app.request(`/api/v1/legal-documents/${doc.publicId}/accept`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: socio.cookie,
        'x-forwarded-for': '190.191.1.2',
        'user-agent': 'LaplaceTest/1.0',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const enBase = await mongoose.connection.db
      ?.collection('consents')
      .findOne<{ ip: string; userAgent: string; contentHash: string; version: number }>({
        documentId: doc.publicId,
      });

    expect(enBase?.ip).toBe('190.191.1.2');
    expect(enBase?.userAgent).toBe('LaplaceTest/1.0');
    expect(enBase?.contentHash).toBe(doc.contentHash);
    expect(enBase?.version).toBe(1);
  });

  it('🔴 se puede verificar el hash contra el texto', async () => {
    const centro = await centroListo('aceptar-hash');
    const doc = await publicar(centro, { contentHtml: '<p>Texto exacto v1.</p>' });
    const socio = await atletaDe(centro, 'Micaela');
    await aceptar(socio.cookie, doc.publicId);

    const enBase = await mongoose.connection.db
      ?.collection('consents')
      .findOne<{ contentHash: string }>({ documentId: doc.publicId });
    const crypto = await import('node:crypto');
    const esperado = crypto.createHash('sha256').update('<p>Texto exacto v1.</p>').digest('hex');

    expect(enBase?.contentHash).toBe(esperado);
  });

  it('aceptar dos veces (doble click) no duplica el registro', async () => {
    const centro = await centroListo('aceptar-doble');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');

    const [uno, dos] = await Promise.all([
      aceptar(socio.cookie, doc.publicId),
      aceptar(socio.cookie, doc.publicId),
    ]);

    expect(uno.status).toBe(200);
    expect(dos.status).toBe(200);
    const cuantos = await mongoose.connection.db
      ?.collection('consents')
      .countDocuments({ documentId: doc.publicId });
    expect(cuantos).toBe(1);
  });

  it('un documento que no existe da 404', async () => {
    const centro = await centroListo('aceptar-inexistente');
    const socio = await atletaDe(centro, 'Micaela');

    const res = await aceptar(socio.cookie, 'doc_no_existe');

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-404-002');
  });

  it('🔴 firmar la v1 no alcanza cuando ya se publicó la v2: pide re-aceptación sola', async () => {
    const centro = await centroListo('re-aceptacion');
    const v1 = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');
    await aceptar(socio.cookie, v1.publicId);
    expect((await pendientes(socio.cookie)).body[0]?.accepted).toBe(true);

    const v2 = await publicar(centro, { contentHtml: '<p>Versión 2, más estricta.</p>' });

    // Nadie corrió un job de "reset": la vigencia de la v2 alcanza sola. Ahora
    // lo pendiente es la v2, no la v1 que ya firmó.
    const { body } = await pendientes(socio.cookie);
    expect(body).toHaveLength(1);
    expect(body[0]?.publicId).toBe(v2.publicId);
    expect(body[0]?.version).toBe(2);
    expect(body[0]?.accepted).toBe(false);
  });
});

describe('el panel de cumplimiento (§2.1.20)', () => {
  it('muestra quién firmó y cuándo', async () => {
    const centro = await centroListo('cumplimiento');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');
    await aceptar(socio.cookie, doc.publicId);

    const { res, body } = (await cumplimiento(centro, doc.publicId)) as {
      res: Response;
      body: { items: Array<{ memberId: string; fullName: string; acceptedAt: string }> };
    };

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.memberId).toBe(socio.memberId);
    expect(body.items[0]?.fullName).toBe('Micaela Socio');
    expect(body.items[0]?.acceptedAt).toBeTruthy();
  });

  it('un socio no puede abrir el panel de otro documento: es de staff', async () => {
    const centro = await centroListo('cumplimiento-sin-permiso');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');

    const res = await app.request(
      `/api/v1/legal-documents/${doc.publicId}/compliance`,
      req(socio.cookie, 'GET'),
    );

    expect(res.status).toBe(403);
  });

  it('un documento sin firmas da una lista vacía, no un error', async () => {
    const centro = await centroListo('cumplimiento-vacio');
    const doc = await publicar(centro);

    const { res, body } = (await cumplimiento(centro, doc.publicId)) as {
      res: Response;
      body: { items: unknown[] };
    };

    expect(res.status).toBe(200);
    expect(body.items).toEqual([]);
  });

  it('🔴 se exporta a CSV para pegarlo en una planilla', async () => {
    const centro = await centroListo('cumplimiento-csv');
    const doc = await publicar(centro);
    const socio = await atletaDe(centro, 'Micaela');
    await aceptar(socio.cookie, doc.publicId);

    const res = await app.request(
      `/api/v1/legal-documents/${doc.publicId}/compliance?format=csv`,
      req(centro.cookie, 'GET'),
    );
    const csv = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(csv.split('\n')[0]).toBe('memberId,fullName,version,acceptedAt');
    expect(csv).toContain(`${socio.memberId},Micaela Socio,1,`);
  });
});

/*
 * Una query mal escrita es error del que la escribe, no del servidor: tiene que
 * volver 422 con el código del envelope (§5.0). El 500 genérico le dice al
 * usuario "se rompió algo" cuando lo único que pasa es que el filtro está mal.
 */
describe('una query inválida vuelve 422, no 500', () => {
  it('un `limit` fuera de rango en el panel se rechaza con LP-SYS-422-006', async () => {
    const centro = await centroListo('cumplimiento-query-invalida');
    const doc = await publicar(centro);

    const res = await app.request(
      `/api/v1/legal-documents/${doc.publicId}/compliance?limit=0`,
      req(centro.cookie, 'GET'),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve los documentos del otro centro', async () => {
    const victima = await centroListo('waivers-victima');
    await publicar(victima);
    const atacante = await centroListo('waivers-atacante');

    const { body } = await pendientes(atacante.cookie);

    expect(body).toEqual([]);
  });

  it('el atacante no puede aceptar un documento de otro centro', async () => {
    const victima = await centroListo('waivers-victima-2');
    const doc = await publicar(victima);
    const atacante = await centroListo('waivers-atacante-2');
    const socioAtacante = await atletaDe(atacante, 'Atacante');

    const res = await aceptar(socioAtacante.cookie, doc.publicId);

    expect(res.status).toBe(404);
  });

  it('el atacante no ve el panel de cumplimiento de otro centro', async () => {
    const victima = await centroListo('waivers-victima-3');
    const doc = await publicar(victima);
    const atacante = await centroListo('waivers-atacante-3');

    const res = await app.request(
      `/api/v1/legal-documents/${doc.publicId}/compliance`,
      req(atacante.cookie, 'GET'),
    );

    expect(res.status).toBe(404);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  const esDeWaivers = (path: string) => path.startsWith('/api/v1/legal-documents');

  it('las cuatro rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter((route) => esDeWaivers(route.path));

    expect(rutas).toHaveLength(4);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('waivers-fixtures');
    const victima = await nuevoCentro('waivers-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!esDeWaivers(route.path) || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        VICTIM_DOCUMENT_TITLE,
      );
    }
  });
});

describe('el chequeo en bloque que consume el panel de alertas (F1-24)', () => {
  const enContexto = <T>(organizationId: string, fn: () => Promise<T>) =>
    runWithTenant({ tenantId: organizationId, userId: 'usr_test', requestId: 'req-alertas' }, fn);

  it('🔴 devuelve solo a los que les falta firmar', async () => {
    const centro = await centroListo('bloque');
    const doc = await publicar(centro);
    const firmante = await atletaDe(centro, 'Firmante');
    const remolon = await atletaDe(centro, 'Remolon');
    await aceptar(firmante.cookie, doc.publicId);

    const faltantes = await enContexto(centro.organizationId, () =>
      modules.waivers.service.missingAmong([firmante.memberId, remolon.memberId]),
    );

    expect(faltantes).toEqual([remolon.memberId]);
  });

  it('sin documentos publicados, no le falta nada a nadie', async () => {
    const centro = await centroListo('bloque-sin-docs');
    const socio = await atletaDe(centro, 'Socio');

    const faltantes = await enContexto(centro.organizationId, () =>
      modules.waivers.service.missingAmong([socio.memberId]),
    );

    expect(faltantes).toEqual([]);
  });

  it('sin socios que revisar, no se consulta nada', async () => {
    const centro = await centroListo('bloque-vacio');

    const faltantes = await enContexto(centro.organizationId, () =>
      modules.waivers.service.missingAmong([]),
    );

    expect(faltantes).toEqual([]);
  });

  it('🔴 el socio sin cuenta vinculada cuenta como faltante', async () => {
    // No hay ningún consentimiento digital en pie: es el mismo criterio que
    // usa el check-in (§2.1.20).
    const centro = await centroListo('bloque-sin-cuenta');
    await publicar(centro);
    const sinCuenta = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
      firstName: 'Walk',
      lastName: 'In',
      venueIds: [centro.venueId],
    });

    const faltantes = await enContexto(centro.organizationId, () =>
      modules.waivers.service.missingAmong([sinCuenta.publicId]),
    );

    expect(faltantes).toEqual([sinCuenta.publicId]);
  });
});
