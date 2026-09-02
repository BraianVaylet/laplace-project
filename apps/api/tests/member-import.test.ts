import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import type { ImportResult, PreviewResult } from '@laplace/schemas';
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
 * F1-05. Migrar el padrón desde Excel o desde un competidor. §2.1.7 lo marca
 * como la fricción número 1 para cambiar de plataforma: si importar duele, el
 * centro no migra.
 *
 * Lo que se verifica y no se negocia: que la previsualización no escriba nada,
 * que un archivo con una fila inválida no escriba nada, y que el límite del plan
 * corte **antes** diciendo cuántos entran y cuántos exceden.
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

const PADRON = [
  'nombre,apellido,dni,celular,email,fecha de nacimiento,etiquetas',
  'Micaela,Sosa,40.123.456,+5492914000001,mica@example.com,12/04/1999,mañana|competidora',
  'Juan,Pérez,40123457,+5492914000002,juan@example.com,1988-11-30,',
  'Ana,Gómez,40123458,+5492914000003,,,',
].join('\n');

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

async function previsualizar(cookie: string, csv: string) {
  return app.request('/api/v1/members/import/preview', req(cookie, 'POST', { csv }));
}

async function previewOk(cookie: string, csv: string): Promise<PreviewResult> {
  const res = await previsualizar(cookie, csv);
  if (res.status !== 200) throw new Error(`preview falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as PreviewResult;
}

async function confirmar(cookie: string, body: Record<string, unknown>) {
  return app.request('/api/v1/members/import', req(cookie, 'POST', body));
}

/** Confirma lo que la previsualización marcó como importable. */
async function importar(cookie: string, csv: string, onDuplicate: 'skip' | 'update' = 'skip') {
  const preview = await previewOk(cookie, csv);
  const rows = preview.rows.filter((row) => row.status !== 'invalid').map((row) => row.data);

  return confirmar(cookie, { venueIds: ['ven_centro'], onDuplicate, rows });
}

async function contarSocios(cookie: string): Promise<number> {
  const res = await app.request('/api/v1/members?limit=100', req(cookie, 'GET'));

  return ((await res.json()) as { items: unknown[] }).items.length;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_import_test' });
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

describe('previsualización', () => {
  it('devuelve el archivo fila por fila y no escribe nada', async () => {
    const { cookie } = await nuevoCentro('preview');

    const preview = await previewOk(cookie, PADRON);

    expect(preview.summary).toEqual({ total: 3, new: 3, duplicate: 0, invalid: 0 });
    expect(await contarSocios(cookie)).toBe(0);
  });

  it('mapea las columnas por alias y normaliza los datos', async () => {
    const { cookie } = await nuevoCentro('alias');

    const preview = await previewOk(cookie, PADRON);
    const mica = preview.rows[0]?.data;

    expect(mica?.firstName).toBe('Micaela');
    // "dni" es alias de documento, y los puntos son de la UI.
    expect(mica?.docId).toBe('40123456');
    // "12/04/1999" es lo que exporta un Excel en es-AR.
    expect(mica?.birthDate).toBe('1999-04-12');
    expect(mica?.tags).toEqual(['mañana', 'competidora']);
  });

  it('avisa qué columnas ignoró en vez de fallar por ellas', async () => {
    const { cookie } = await nuevoCentro('ignoradas');

    const preview = await previewOk(
      cookie,
      'nombre,apellido,observaciones\nMicaela,Sosa,vino por instagram',
    );

    // El archivo del competidor trae columnas que no usamos. Rechazarlo por eso
    // sería exactamente la fricción que esta tarea existe para sacar.
    expect(preview.ignoredColumns).toEqual(['observaciones']);
    expect(preview.summary.new).toBe(1);
  });

  it('marca la fila inválida con su columna y su motivo, en español', async () => {
    const { cookie } = await nuevoCentro('invalida');

    const preview = await previewOk(cookie, 'nombre,apellido,email\nM,Sosa,esto-no-es-un-mail');
    const fila = preview.rows[0];

    expect(fila?.status).toBe('invalid');
    expect(fila?.rowNumber).toBe(2);
    expect(fila?.issues.map((issue) => issue.column)).toContain('nombre');
    expect(fila?.issues.map((issue) => issue.message)).toContain('Cargá el nombre.');
  });

  it('una fila inválida no aborta el resto del archivo', async () => {
    const { cookie } = await nuevoCentro('parcial');

    const preview = await previewOk(
      cookie,
      ['nombre,apellido', 'M,Sosa', 'Juan,Pérez', 'Ana,Gómez'].join('\n'),
    );

    expect(preview.summary).toEqual({ total: 3, new: 2, duplicate: 0, invalid: 1 });
  });

  it('detecta el documento que ya existe en el centro y dice a quién pisa', async () => {
    const { cookie } = await nuevoCentro('duplicado');
    await app.request(
      '/api/v1/members',
      req(cookie, 'POST', {
        firstName: 'Micaela',
        lastName: 'Sosa',
        docId: '40123456',
        venueIds: ['ven_centro'],
      }),
    );

    const preview = await previewOk(cookie, PADRON);

    expect(preview.rows[0]?.status).toBe('duplicate');
    expect(preview.rows[0]?.existingMemberId).toMatch(/^mem_/);
    expect(preview.summary).toEqual({ total: 3, new: 2, duplicate: 1, invalid: 0 });
  });

  it('detecta el documento repetido DENTRO del archivo y dice en qué fila estaba', async () => {
    const { cookie } = await nuevoCentro('repetido-interno');

    const preview = await previewOk(
      cookie,
      ['nombre,apellido,dni', 'Micaela,Sosa,40123456', 'Otra,Persona,40123456'].join('\n'),
    );

    expect(preview.rows[1]?.status).toBe('invalid');
    expect(preview.rows[1]?.issues[0]?.message).toContain('fila 2');
  });

  it('dice cuántos entran en el plan y cuántos exceden', async () => {
    const { cookie, organizationId } = await nuevoCentro('plan-preview');
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 2 } });
    entitlements.invalidateAll();

    const preview = await previewOk(cookie, PADRON);

    expect(preview.planCheck).toEqual({ limit: 2, current: 0, wouldCreate: 3, exceeds: 1 });
  });

  it('rechaza un archivo sin las columnas mínimas, diciendo cuáles acepta', async () => {
    const { cookie } = await nuevoCentro('sin-columnas');

    const res = await previsualizar(cookie, 'documento,telefono\n40123456,+549291');
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-MEMB-422-006');
    expect(body.error.action).toContain('nombre');
  });

  it('rechaza un archivo que no es un CSV', async () => {
    const { cookie } = await nuevoCentro('no-csv');

    const res = await previsualizar(cookie, '   ');

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-422-006');
  });
});

describe('confirmación', () => {
  it('importa el padrón completo y deja el resumen fila por fila', async () => {
    const { cookie } = await nuevoCentro('importar');

    const res = await importar(cookie, PADRON);
    const body = (await res.json()) as ImportResult;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ created: 3, updated: 0, skipped: 0 });
    expect(body.details).toHaveLength(3);
    expect(body.details[0]).toMatchObject({ rowNumber: 2, action: 'created' });
    expect(await contarSocios(cookie)).toBe(3);
  });

  it('los socios importados quedan como `lead` en la sede elegida', async () => {
    const { cookie } = await nuevoCentro('lead');
    await importar(cookie, PADRON);

    const listado = await app.request('/api/v1/members', req(cookie, 'GET'));
    const items = (
      (await listado.json()) as { items: Array<{ status: string; venueIds: string[] }> }
    ).items;

    for (const socio of items) {
      expect(socio.status).toBe('lead');
      expect(socio.venueIds).toEqual(['ven_centro']);
    }
  });

  it('el duplicado se saltea por default y queda registrado en el resumen', async () => {
    const { cookie } = await nuevoCentro('saltear');
    await importar(cookie, PADRON);

    const res = await importar(cookie, PADRON);
    const body = (await res.json()) as ImportResult;

    expect(body).toMatchObject({ created: 0, updated: 0, skipped: 3 });
    expect(body.details[0]?.reason).toContain('Ya existe');
    expect(await contarSocios(cookie)).toBe(3);
  });

  it('con `update`, el duplicado se actualiza en vez de saltearse', async () => {
    const { cookie } = await nuevoCentro('actualizar');
    await importar(cookie, PADRON);

    const corregido = PADRON.replace('Micaela,Sosa', 'Micaela,Sosa Fernández');
    const res = await importar(cookie, corregido, 'update');
    const body = (await res.json()) as ImportResult;

    expect(body).toMatchObject({ created: 0, updated: 3, skipped: 0 });

    const listado = await app.request('/api/v1/members', req(cookie, 'GET'));
    const apellidos = ((await listado.json()) as { items: Array<{ lastName: string }> }).items.map(
      (socio) => socio.lastName,
    );
    expect(apellidos).toContain('Sosa Fernández');
  });

  it('un documento repetido dentro del archivo corta el import sin escribir nada', async () => {
    const { cookie } = await nuevoCentro('repetido-confirm');

    const res = await confirmar(cookie, {
      venueIds: ['ven_centro'],
      rows: [
        { firstName: 'Micaela', lastName: 'Sosa', docId: '40123456' },
        { firstName: 'Otra', lastName: 'Persona', docId: '40123456' },
      ],
    });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-MEMB-409-001');
    expect(body.error.message).toContain('filas 2 y 3');
    // Lo importante: ni siquiera la primera fila, que era válida, se escribió.
    expect(await contarSocios(cookie)).toBe(0);
  });

  it('un documento que el chequeo no ve pero el índice sí da 409 con su fila', async () => {
    const { cookie, organizationId } = await nuevoCentro('carrera');
    /*
     * Un socio borrado logicamente sigue reservando su documento: el repositorio
     * filtra los borrados, asi que el chequeo previo no lo encuentra, pero el
     * indice unico no sabe de borrado logico y corta igual. Es el mismo caso que
     * una carrera entre el chequeo y la escritura, y es reproducible.
     */
    await mongoose.connection.db?.collection('members').insertOne({
      tenantId: organizationId,
      publicId: 'mem_plantado',
      docId: '40123457',
      firstName: 'Plantado',
      lastName: 'Antes',
      status: 'lead',
      deletedAt: new Date(),
    });

    const res = await confirmar(cookie, {
      venueIds: ['ven_centro'],
      rows: [
        { firstName: 'Micaela', lastName: 'Sosa', docId: '40123456' },
        { firstName: 'Juan', lastName: 'Pérez', docId: '40123457' },
      ],
    });
    const body = (await res.json()) as ErrorBody;

    // Con 143 filas, "algo falló" no sirve: tiene que decir cuál.
    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-MEMB-409-001');
    expect(body.error.message).toContain('fila 3');
  });

  it('una fila inválida corta el import entero sin escribir nada', async () => {
    const { cookie } = await nuevoCentro('invalida-confirm');

    const res = await confirmar(cookie, {
      venueIds: ['ven_centro'],
      rows: [
        { firstName: 'Micaela', lastName: 'Sosa' },
        { firstName: 'M', lastName: 'Sosa' },
      ],
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-SYS-422-006');
    expect(await contarSocios(cookie)).toBe(0);
  });
});

describe('límite del plan', () => {
  it('corta ANTES de escribir y dice cuántos exceden', async () => {
    const { cookie, organizationId } = await nuevoCentro('plan-corta');
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 2 } });
    entitlements.invalidateAll();

    const res = await importar(cookie, PADRON);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(403);
    expect(body.error.code).toBe('LP-ENTL-403-001');
    // Un "no entrás" sin número obliga al centro a borrar filas al azar.
    expect(body.error.message).toContain('2');
    expect(body.error.message).toContain('1');
    // No entró ninguno: el archivo se importa entero o no se importa.
    expect(await contarSocios(cookie)).toBe(0);
  });

  it('cuenta los que ya están: el archivo que entraba solo deja de entrar', async () => {
    const { cookie, organizationId } = await nuevoCentro('plan-acumula');
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 4 } });
    entitlements.invalidateAll();
    await importar(cookie, PADRON);

    const otros = ['nombre,apellido,dni', 'Otra,Persona,50123456', 'Mas,Gente,50123457'].join('\n');
    const res = await importar(cookie, otros);

    expect(res.status).toBe(403);
    expect(await contarSocios(cookie)).toBe(3);
  });

  it('un plan sin límite importa el archivo entero', async () => {
    const { cookie, organizationId } = await nuevoCentro('plan-max');
    planPorOrg.set(organizationId, { planId: 'max' });
    entitlements.invalidateAll();

    const res = await importar(cookie, PADRON);

    expect(res.status).toBe(200);
    expect(await contarSocios(cookie)).toBe(3);
  });

  it('los duplicados no consumen cupo: se cuentan solo los que se crean', async () => {
    const { cookie, organizationId } = await nuevoCentro('plan-duplicados');
    planPorOrg.set(organizationId, { planId: 'basic', planLimits: { activeMembers: 3 } });
    entitlements.invalidateAll();
    await importar(cookie, PADRON);

    // Reimportar el mismo archivo no crea a nadie, así que no puede excederse.
    const res = await importar(cookie, PADRON);

    expect(res.status).toBe(200);
  });
});

describe('aislamiento de tenant', () => {
  it('la previsualización no confirma si un documento existe en OTRO centro', async () => {
    const victima = await nuevoCentro('imp-victima');
    await app.request(
      '/api/v1/members',
      req(victima.cookie, 'POST', {
        firstName: 'Confidencial',
        lastName: 'Persona',
        docId: '99999999',
        venueIds: ['ven_centro'],
      }),
    );
    const atacante = await nuevoCentro('imp-atacante');

    const preview = await previewOk(atacante.cookie, 'nombre,apellido,dni\nSonda,Ajena,99999999');

    /*
     * El ataque no es leer una ficha: es preguntarle al preview si un documento
     * ya existe. Un `duplicate` de vuelta confirmaría que esa persona es socia
     * del otro centro.
     */
    expect(preview.rows[0]?.status).toBe('new');
    expect(preview.rows[0]?.existingMemberId).toBeUndefined();
  });

  it('lo importado queda en el centro de la sesión, no en otro', async () => {
    const uno = await nuevoCentro('imp-uno');
    const otro = await nuevoCentro('imp-otro');
    await importar(uno.cookie, PADRON);

    expect(await contarSocios(uno.cookie)).toBe(3);
    expect(await contarSocios(otro.cookie)).toBe(0);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las dos rutas de import traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter((route) =>
      route.path.startsWith('/api/v1/members/import'),
    );

    expect(rutas).toHaveLength(2);
    for (const route of rutas) {
      expect(route.tenantScoped, route.path).toBe(true);
      expect(route.isolationFixture, route.path).toBeDefined();
    }
  });

  it('cada ruta montada está declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/members/import'))
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/members/import'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });
});
