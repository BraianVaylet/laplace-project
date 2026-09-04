import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { MEMBER_STATES, type MemberStatus } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import type { OrganizationEntitlementSource } from '../src/entitlements/entitlements.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { VICTIM_MEMBER_NAME } from '../src/modules/members/infrastructure/routes.js';
import { createModuleRoutes } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-03. El socio: la entidad sobre la que gira el resto del producto.
 *
 * Lo que se verifica y no se negocia: la máquina de estados completa, el único
 * por documento contra el índice de verdad, el límite del plan contando solo a
 * los que ocupan cupo, el tutor de un menor y que las notas internas del staff
 * no salgan nunca en la ficha.
 */
const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260901120000-mandatory-indexes.cjs') as {
  up(db: Db): Promise<void>;
};

let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};

const planPorOrg = new Map<string, OrganizationEntitlementSource>();
const entitlements = createEntitlementsLoader((organizationId) =>
  Promise.resolve(planPorOrg.get(organizationId) ?? { planId: 'basic' }),
);

/** El "hoy" del servicio. Fijo para que los tests de mayoría de edad no caduquen. */
const HOY = '2026-09-01';

const MICAELA = { firstName: 'Micaela', lastName: 'Sosa', venueIds: ['ven_centro'] } as const;

interface MemberBody {
  publicId: string;
  firstName: string;
  lastName: string;
  docId?: string;
  status: MemberStatus;
  flags: { debtor: boolean; suspended: boolean };
  tags: string[];
  balanceCents: number;
  notes?: unknown;
}
interface NoteBody {
  publicId: string;
  text: string;
  authorId: string;
  createdAt: string;
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

async function altaSocio(cookie: string, overrides: Record<string, unknown> = {}) {
  return app.request('/api/v1/members', req(cookie, 'POST', { ...MICAELA, ...overrides }));
}

async function altaOk(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await altaSocio(cookie, overrides);
  if (res.status !== 201) throw new Error(`alta falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as MemberBody;
}

async function listar(cookie: string, query = '') {
  const res = await app.request(`/api/v1/members${query}`, req(cookie, 'GET'));

  return (await res.json()) as { items: MemberBody[]; nextCursor: string | null };
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_members_test' });

  // Se corre la migracion de verdad: el unico por documento se prueba contra el
  // indice que va a existir en produccion, no contra uno inventado para el test.
  await migration.up(mongoose.connection.db as Db);

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
      today: () => HOY,
    }),
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(async () => {
  planPorOrg.clear();
  entitlements.invalidateAll();
  await mongoose.connection.db?.collection('members').deleteMany({});
});

describe('alta de socio', () => {
  it('registra la ficha completa de §2.1.7', async () => {
    const { cookie } = await nuevoCentro('alta');

    const res = await altaSocio(cookie, {
      docId: '40.123.456',
      phone: '+5492914000000',
      birthDate: '1999-04-12',
      emergencyContact: { fullName: 'Ana Sosa', phone: '+5492914111111', relationship: 'hermana' },
    });
    const body = (await res.json()) as MemberBody;

    expect(res.status).toBe(201);
    expect(body.firstName).toBe('Micaela');
    // El documento se guarda normalizado: los puntos son de la UI.
    expect(body.docId).toBe('40123456');
    expect(body.status).toBe('lead');
    expect(body.flags).toEqual({ debtor: false, suspended: false });
    expect(body.balanceCents).toBe(0);
  });

  it('un documento repetido en el mismo centro responde LP-MEMB-409-001', async () => {
    const { cookie } = await nuevoCentro('duplicado');
    await altaOk(cookie, { docId: '40123456' });

    const res = await altaSocio(cookie, { firstName: 'Otra', docId: '40123456' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-MEMB-409-001');
    // Puede estar archivado, y por eso no aparecía en el listado que miró el staff.
    expect(body.error.action).toContain('archivado');
  });

  it('el índice único es el que garantiza la unicidad, no el chequeo previo', async () => {
    const { cookie, organizationId } = await nuevoCentro('indice');
    await altaOk(cookie, { docId: '40123456' });

    /*
     * Se escribe por el driver, salteando el servicio: entre el `findOne` previo
     * y el `create` hay una ventana, y dos altas simultáneas del mismo DNI la
     * encuentran. Lo que la cierra es el índice, y esto lo prueba.
     */
    const duplicado = mongoose.connection.db?.collection('members').insertOne({
      tenantId: organizationId,
      publicId: 'mem_duplicado',
      docId: '40123456',
      firstName: 'Otra',
      lastName: 'Persona',
      deletedAt: null,
    });

    await expect(duplicado).rejects.toMatchObject({ code: 11000 });
  });

  it('un socio borrado lógicamente sigue reservando su documento, y da 409 y no 500', async () => {
    const { cookie, organizationId } = await nuevoCentro('doc-borrado');
    await mongoose.connection.db?.collection('members').insertOne({
      tenantId: organizationId,
      publicId: 'mem_borrada',
      docId: '40123456',
      firstName: 'Borrada',
      lastName: 'Persona',
      // El indice unico no sabe de borrado logico: sigue viendo este documento.
      deletedAt: new Date(),
    });

    const res = await altaSocio(cookie, { docId: '40123456' });

    // El chequeo previo no lo encuentra (el repositorio filtra los borrados),
    // asi que el que corta es el indice. Sin traducir el E11000, esto seria un
    // 500 y el staff no entenderia por que no puede cargar a esa persona.
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-409-001');
  });

  it('el mismo documento en OTRO centro es otra persona y se acepta', async () => {
    const uno = await nuevoCentro('doc-centro-a');
    const otro = await nuevoCentro('doc-centro-b');
    await altaOk(uno.cookie, { docId: '40123456' });

    const res = await altaSocio(otro.cookie, { docId: '40123456' });

    // El indice es `{ tenantId, docId }`: si fuera solo `docId`, el primer centro
    // que carga un DNI se lo bloquearía a todos los demás.
    expect(res.status).toBe(201);
  });

  it('dos socios sin documento no chocan entre sí', async () => {
    const { cookie } = await nuevoCentro('sin-doc');
    await altaOk(cookie);

    const res = await altaSocio(cookie, { firstName: 'Otra' });

    // Es lo que el índice PARCIAL garantiza y uno `sparse` compuesto no: sin el
    // `partialFilterExpression`, los dos documentos sin `docId` colisionan.
    expect(res.status).toBe(201);
  });

  it('el documento vacío no cuenta como documento', async () => {
    const { cookie } = await nuevoCentro('doc-vacio');
    await altaOk(cookie, { docId: '   ' });

    expect((await altaSocio(cookie, { firstName: 'Otra', docId: '' })).status).toBe(201);
  });

  it('un menor sin tutor responde LP-MEMB-422-004', async () => {
    const { cookie } = await nuevoCentro('menor');

    const res = await altaSocio(cookie, { birthDate: '2012-05-10' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-MEMB-422-004');
  });

  it('un menor con tutor se da de alta', async () => {
    const { cookie } = await nuevoCentro('menor-ok');

    const res = await altaSocio(cookie, {
      birthDate: '2012-05-10',
      guardian: { fullName: 'Ana Sosa', phone: '+5492914111111', relationship: 'madre' },
    });

    expect(res.status).toBe(201);
  });

  it('el que cumplió 18 hoy ya no necesita tutor', async () => {
    const { cookie } = await nuevoCentro('recien-mayor');

    expect((await altaSocio(cookie, { birthDate: '2008-09-01' })).status).toBe(201);
    expect((await altaSocio(cookie, { firstName: 'Otro', birthDate: '2008-09-02' })).status).toBe(
      422,
    );
  });

  it('el PATCH no deja robarle el documento a otro socio', async () => {
    const { cookie } = await nuevoCentro('patch-doc');
    await altaOk(cookie, { firstName: 'Primera', docId: '40123456' });
    const segunda = await altaOk(cookie, { firstName: 'Segunda', docId: '40999999' });

    const res = await app.request(
      `/api/v1/members/${segunda.publicId}`,
      req(cookie, 'PATCH', { docId: '40123456' }),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-409-001');
  });

  it('el PATCH acepta reenviar el documento propio: no es un conflicto', async () => {
    const { cookie } = await nuevoCentro('patch-doc-propio');
    const socio = await altaOk(cookie, { docId: '40123456' });

    const res = await app.request(
      `/api/v1/members/${socio.publicId}`,
      req(cookie, 'PATCH', { docId: '40.123.456', phone: '+5492914000000' }),
    );

    // El formulario manda la ficha entera, incluido el documento sin cambios.
    // Tratarlo como duplicado haria imposible editar el telefono.
    expect(res.status).toBe(200);
  });

  it('cargar la fecha de nacimiento por PATCH vuelve a exigir el tutor', async () => {
    const { cookie } = await nuevoCentro('patch-menor');
    const socio = await altaOk(cookie);

    const res = await app.request(
      `/api/v1/members/${socio.publicId}`,
      req(cookie, 'PATCH', { birthDate: '2012-05-10' }),
    );

    // Sin esto, el corte del menor se saltea cargando la fecha después del alta.
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-422-004');
  });
});

describe('máquina de estados (§14)', () => {
  it('recorre el embudo completo', async () => {
    const { cookie } = await nuevoCentro('embudo');
    const socio = await altaOk(cookie);

    for (const to of ['trial', 'active', 'at_risk', 'inactive', 'archived'] as const) {
      const res = await app.request(
        `/api/v1/members/${socio.publicId}/status`,
        req(cookie, 'POST', { to }),
      );
      expect(res.status, to).toBe(200);
      expect(((await res.json()) as MemberBody).status, to).toBe(to);
    }
  });

  it('un salto inválido responde LP-MEMB-422-002 y no toca el estado', async () => {
    const { cookie } = await nuevoCentro('salto');
    const socio = await altaOk(cookie);

    const res = await app.request(
      `/api/v1/members/${socio.publicId}/status`,
      req(cookie, 'POST', { to: 'at_risk' }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-422-002');

    const sinTocar = await app.request(`/api/v1/members/${socio.publicId}`, req(cookie, 'GET'));
    expect(((await sinTocar.json()) as MemberBody).status).toBe('lead');
  });

  it('el estado no se puede pisar con un PATCH libre', async () => {
    const { cookie } = await nuevoCentro('pisar');
    const socio = await altaOk(cookie);

    await app.request(
      `/api/v1/members/${socio.publicId}`,
      req(cookie, 'PATCH', { status: 'archived' }),
    );

    const res = await app.request(`/api/v1/members/${socio.publicId}`, req(cookie, 'GET'));
    expect(((await res.json()) as MemberBody).status).toBe('lead');
  });

  it('el archivado tiene su propio endpoint y también valida la transición', async () => {
    const { cookie } = await nuevoCentro('archivar');
    const socio = await altaOk(cookie);

    const primera = await app.request(
      `/api/v1/members/${socio.publicId}/archive`,
      req(cookie, 'POST', {}),
    );
    expect(((await primera.json()) as MemberBody).status).toBe('archived');

    const segunda = await app.request(
      `/api/v1/members/${socio.publicId}/archive`,
      req(cookie, 'POST', {}),
    );
    expect(segunda.status).toBe(422);
  });
});

describe('flags transversales', () => {
  it('un socio puede estar `active` y `suspended` a la vez', async () => {
    const { cookie } = await nuevoCentro('flags');
    const socio = await altaOk(cookie, { status: 'active' });

    const res = await app.request(
      `/api/v1/members/${socio.publicId}/suspend`,
      req(cookie, 'POST', {}),
    );
    const body = (await res.json()) as MemberBody;

    // Modelarlo como estado obligaría a elegir, y "activo con sanción" es
    // exactamente el caso que el staff necesita representar.
    expect(body.status).toBe('active');
    expect(body.flags.suspended).toBe(true);
  });

  it('levantar la sanción no cambia el estado del embudo', async () => {
    const { cookie } = await nuevoCentro('flags-off');
    const socio = await altaOk(cookie, { status: 'active' });
    await app.request(`/api/v1/members/${socio.publicId}/suspend`, req(cookie, 'POST', {}));

    const res = await app.request(
      `/api/v1/members/${socio.publicId}/unsuspend`,
      req(cookie, 'POST', {}),
    );
    const body = (await res.json()) as MemberBody;

    expect(body.status).toBe('active');
    expect(body.flags.suspended).toBe(false);
  });
});

describe('notas internas (§2.1.7)', () => {
  it('se escriben con autor y fecha', async () => {
    const { cookie } = await nuevoCentro('notas');
    const socio = await altaOk(cookie);

    const res = await app.request(
      `/api/v1/members/${socio.publicId}/notes`,
      req(cookie, 'POST', { text: 'Prefiere el turno de la mañana.' }),
    );
    const body = (await res.json()) as NoteBody;

    expect(res.status).toBe(201);
    expect(body.text).toBe('Prefiere el turno de la mañana.');
    expect(body.authorId).toBeTruthy();
    expect(body.createdAt).toBeTruthy();
  });

  it('NUNCA salen en la ficha del socio', async () => {
    const { cookie } = await nuevoCentro('notas-ocultas');
    const socio = await altaOk(cookie);
    await app.request(
      `/api/v1/members/${socio.publicId}/notes`,
      req(cookie, 'POST', { text: 'Prefiere el turno de la mañana.' }),
    );

    const ficha = await app.request(`/api/v1/members/${socio.publicId}`, req(cookie, 'GET'));
    const listado = await app.request('/api/v1/members', req(cookie, 'GET'));

    // La respuesta es una lista blanca, no un `delete doc.notes`: el día que se
    // agregue un campo sensible al documento, tampoco va a salir por acá.
    for (const res of [ficha, listado]) {
      const texto = await res.text();
      expect(texto).not.toContain('turno de la mañana');
      expect(texto).not.toContain('"notes"');
    }
  });

  it('las más nuevas primero: es el orden en que las lee el staff', async () => {
    const { cookie } = await nuevoCentro('notas-orden');
    const socio = await altaOk(cookie);
    for (const text of ['primera', 'segunda', 'tercera']) {
      await app.request(`/api/v1/members/${socio.publicId}/notes`, req(cookie, 'POST', { text }));
    }

    const res = await app.request(`/api/v1/members/${socio.publicId}/notes`, req(cookie, 'GET'));
    const notas = (await res.json()) as NoteBody[];

    expect(notas.map((nota) => nota.text)).toEqual(['tercera', 'segunda', 'primera']);
  });
});

describe('límite del plan', () => {
  it('el socio 61 de un centro Basic responde LP-ENTL-403-001', async () => {
    const { cookie, organizationId } = await nuevoCentro('limite');
    // Sesenta altas por HTTP tardarían de más: se baja el límite del plan, que
    // es la misma regla con otro número.
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 2 } });
    entitlements.invalidateAll();

    await altaOk(cookie, { firstName: 'Uno' });
    await altaOk(cookie, { firstName: 'Dos' });
    const res = await altaSocio(cookie, { firstName: 'Tres' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-ENTL-403-001');
    expect(body.error.message).toContain('2');
  });

  it('archivar libera cupo: los que se fueron no cuestan plata (§2.2.1)', async () => {
    const { cookie, organizationId } = await nuevoCentro('libera');
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 1 } });
    entitlements.invalidateAll();

    const primero = await altaOk(cookie, { firstName: 'Uno' });
    expect((await altaSocio(cookie, { firstName: 'Dos' })).status).toBe(403);

    await app.request(`/api/v1/members/${primero.publicId}/archive`, req(cookie, 'POST', {}));

    expect((await altaSocio(cookie, { firstName: 'Dos' })).status).toBe(201);
  });

  it('el límite corta antes de escribir: no queda una ficha a medias', async () => {
    const { cookie, organizationId } = await nuevoCentro('sin-huecos');
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 1 } });
    entitlements.invalidateAll();
    await altaOk(cookie, { firstName: 'Uno' });

    await altaSocio(cookie, { firstName: 'Dos' });

    expect((await listar(cookie)).items).toHaveLength(1);
  });
});

describe('listado y filtros', () => {
  it('filtra por estado, sede y etiqueta', async () => {
    const { cookie } = await nuevoCentro('filtros');
    await altaOk(cookie, { firstName: 'Activa', status: 'active', tags: ['Mañana'] });
    await altaOk(cookie, { firstName: 'Prospecto', venueIds: ['ven_otra'] });

    expect((await listar(cookie, '?status=active')).items).toHaveLength(1);
    expect((await listar(cookie, '?venueId=ven_otra')).items).toHaveLength(1);
    // La etiqueta se guarda normalizada: se busca en minúscula.
    expect((await listar(cookie, '?tag=mañana')).items).toHaveLength(1);
    expect((await listar(cookie, '?tag=Mañana')).items).toHaveLength(0);
  });

  it('un socio inexistente da 404 con código tipado', async () => {
    const { cookie } = await nuevoCentro('inexistente');

    const res = await app.request('/api/v1/members/mem_no_existe', req(cookie, 'GET'));

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-404-003');
  });
});

describe('aislamiento de tenant', () => {
  async function dosCentros() {
    const victima = await nuevoCentro('memb-victima');
    const socio = await altaOk(victima.cookie, { firstName: 'Confidencial', docId: '99999999' });
    const atacante = await nuevoCentro('memb-atacante');

    return { victima, atacante, socioId: socio.publicId };
  }

  it('el atacante no lee la ficha del otro centro: 404, no 403', async () => {
    const { atacante, socioId } = await dosCentros();

    const res = await app.request(`/api/v1/members/${socioId}`, req(atacante.cookie, 'GET'));

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Confidencial');
  });

  it('tampoco la edita, la archiva ni le cambia el estado', async () => {
    const { atacante, socioId } = await dosCentros();

    for (const [method, path, body] of [
      ['PATCH', `/api/v1/members/${socioId}`, { firstName: 'Tomada' }],
      ['POST', `/api/v1/members/${socioId}/status`, { to: 'active' }],
      ['POST', `/api/v1/members/${socioId}/archive`, {}],
      ['POST', `/api/v1/members/${socioId}/suspend`, {}],
    ] as const) {
      const res = await app.request(path, req(atacante.cookie, method, body));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('no lee ni escribe las notas del otro centro', async () => {
    const { victima, atacante, socioId } = await dosCentros();
    await app.request(
      `/api/v1/members/${socioId}/notes`,
      req(victima.cookie, 'POST', { text: 'dato reservado del otro centro' }),
    );

    const leer = await app.request(`/api/v1/members/${socioId}/notes`, req(atacante.cookie, 'GET'));
    const escribir = await app.request(
      `/api/v1/members/${socioId}/notes`,
      req(atacante.cookie, 'POST', { text: 'inyectada' }),
    );

    expect(leer.status).toBe(404);
    expect(await leer.text()).not.toContain('dato reservado');
    expect(escribir.status).toBe(404);
  });

  it('el listado del atacante sale vacío', async () => {
    const { atacante } = await dosCentros();

    expect((await listar(atacante.cookie)).items).toEqual([]);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las once rutas de members traen su fixture de ataque', () => {
    // Las de `/import` son de F1-05 y el estado de cuenta es de Billing (F1-10):
    // cada una tiene su propia suite.
    const members = allRegisteredRoutes().filter(
      (route) =>
        route.path.startsWith('/api/v1/members') &&
        !route.path.startsWith('/api/v1/members/import') &&
        !route.path.endsWith('/statement'),
    );

    expect(members).toHaveLength(11);
    for (const route of members) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('memb-fixtures');
    const victima = await nuevoCentro('memb-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!route.path.startsWith('/api/v1/members') || !route.isolationFixture) continue;
      if (route.path.startsWith('/api/v1/members/import')) continue;
      if (route.path.endsWith('/statement')) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(VICTIM_MEMBER_NAME);
    }
  });

  it('cada ruta montada está declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/members'))
      .filter((route) => route.method !== 'ALL')
      .filter((route) => !route.path.endsWith('/statement'))
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/members'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });

  it('los seis estados de §14 están cubiertos por la máquina', () => {
    expect([...MEMBER_STATES]).toHaveLength(6);
  });
});

describe('el buscador global (F1-24)', () => {
  const buscar = async (centro: { cookie: string }, q: string) => {
    const res = await app.request(
      `/api/v1/members/search?q=${encodeURIComponent(q)}`,
      req(centro.cookie, 'GET'),
    );

    return {
      res,
      body: (await res.json()) as Array<{ memberId: string; fullName: string; hint: string }>,
    };
  };

  it('encuentra por nombre, por apellido y por documento', async () => {
    const centro = await nuevoCentro('buscador');
    await altaOk(centro.cookie, { firstName: 'Micaela', lastName: 'Sosa', docId: '30123456' });

    expect((await buscar(centro, 'Mica')).body[0]?.fullName).toBe('Micaela Sosa');
    expect((await buscar(centro, 'Sosa')).body[0]?.fullName).toBe('Micaela Sosa');
    expect((await buscar(centro, '30123')).body[0]?.hint).toBe('30123456');
  });

  it('encuentra por teléfono', async () => {
    const centro = await nuevoCentro('buscador-tel');
    await altaOk(centro.cookie, {
      firstName: 'Julián',
      lastName: 'Pérez',
      phone: '+542914567890',
    });

    expect((await buscar(centro, '542914')).body).toHaveLength(1);
  });

  it('🔴 un término con metacaracteres no rompe ni barre la colección', async () => {
    const centro = await nuevoCentro('buscador-regex');
    await altaOk(centro.cookie, { firstName: 'Micaela', lastName: 'Sosa' });

    // Sin escapar, `(` tira un error de sintaxis y `.*` devuelve a todos.
    const parentesis = await buscar(centro, '(((');
    const comodin = await buscar(centro, '.*');

    expect(parentesis.res.status).toBe(200);
    expect(parentesis.body).toEqual([]);
    expect(comodin.body).toEqual([]);
  });

  it('con una sola letra no busca: pide al menos dos', async () => {
    const centro = await nuevoCentro('buscador-corto');

    expect((await buscar(centro, 'a')).res.status).toBe(422);
  });

  it('🔴 no encuentra a los socios del otro centro', async () => {
    const victima = await nuevoCentro('buscador-victima');
    await altaOk(victima.cookie, { firstName: 'Secreta', lastName: 'Ajena' });
    const atacante = await nuevoCentro('buscador-atacante');

    expect((await buscar(atacante, 'Secreta')).body).toEqual([]);
  });
});
