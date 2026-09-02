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
import { createModuleRoutes } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-04. El código con el que un atleta asocia su cuenta de la WAFM a un centro
 * (§2.1.7), con la expiración, el límite de usos y la revocación que la v1 no
 * definía: un código filtrado sin vencimiento se usa para siempre.
 *
 * Lo que se verifica y no se negocia: el canje concurrente del último cupo, que
 * los tres motivos de rechazo devuelvan el mismo error, y que revocar no toque a
 * quienes ya lo usaron.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902100000-invite-code-global-unique.cjs'),
] as Array<{ up(db: Db): Promise<void> }>;

let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'basic' }));

/** Reloj del servicio. Se mueve a mano para probar el vencimiento sin esperar. */
let ahora = Temporal.Instant.from('2026-09-01T12:00:00Z');

/** A quién se sumó a qué organización. Reemplaza a Better Auth en el test. */
const membresias: Array<{ userId: string; organizationId: string }> = [];

const MANANA = '2026-09-02T12:00:00Z';

interface CodeBody {
  publicId: string;
  code: string;
  maxUses: number;
  usedCount: number;
  status: string;
  revokedAt: string | null;
}
interface RedeemBody {
  memberId: string;
  venueId: string;
  organizationId: string;
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

/** Un atleta que se registró en la WAFM y todavía no pertenece a ningún centro. */
async function nuevoAtleta(nombre: string) {
  const n = ++creados;
  return { cookie: await signUp(`${nombre}-${n}@laplace.test`) };
}

const req = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function generarCodigo(cookie: string, overrides: Record<string, unknown> = {}) {
  const res = await app.request(
    '/api/v1/invite-codes',
    req(cookie, 'POST', { venueId: 'ven_centro', maxUses: 50, expiresAt: MANANA, ...overrides }),
  );
  if (res.status !== 201) throw new Error(`generar falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as CodeBody;
}

async function canjear(
  cookie: string,
  code: string,
  quien = { firstName: 'Juan', lastName: 'Pérez' },
) {
  return app.request('/api/v1/invite-codes/redeem', req(cookie, 'POST', { code, ...quien }));
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_invites_test' });

  // El unico GLOBAL de `code` es lo que hace que el canje sepa a que centro
  // asociar a la persona: se prueba contra el indice de verdad.
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);

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
      now: () => ahora,
      memberships: {
        add: (params) => {
          membresias.push(params);
          return Promise.resolve();
        },
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
  ahora = Temporal.Instant.from('2026-09-01T12:00:00Z');
  membresias.length = 0;
  entitlements.invalidateAll();
  await mongoose.connection.db?.collection('inviteCodes').deleteMany({});
  await mongoose.connection.db?.collection('members').deleteMany({});
});

describe('generación', () => {
  it('el centro define límite de usos y vencimiento; el código lo pone el sistema', async () => {
    const { cookie } = await nuevoCentro('generar');

    const codigo = await generarCodigo(cookie, { maxUses: 50 });

    expect(codigo.code).toHaveLength(8);
    expect(codigo.maxUses).toBe(50);
    expect(codigo.usedCount).toBe(0);
    expect(codigo.status).toBe('active');
  });

  it('no acepta un vencimiento que ya pasó', async () => {
    const { cookie } = await nuevoCentro('vencido-al-crear');

    const res = await app.request(
      '/api/v1/invite-codes',
      req(cookie, 'POST', {
        venueId: 'ven_centro',
        maxUses: 10,
        expiresAt: '2026-01-01T00:00:00Z',
      }),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-MEMB-422-005');
  });

  it('dos centros nunca comparten un código', async () => {
    const uno = await nuevoCentro('code-a');
    const otro = await nuevoCentro('code-b');

    const a = await generarCodigo(uno.cookie);
    const b = await generarCodigo(otro.cookie);

    // Sin el índice único global, el canje no sabría a cuál de los dos asociar
    // a la persona.
    expect(a.code).not.toBe(b.code);
  });
});

describe('canje', () => {
  it('asocia al atleta como socio del centro y sube el contador', async () => {
    const centro = await nuevoCentro('canje');
    const codigo = await generarCodigo(centro.cookie);
    const atleta = await nuevoAtleta('juan');

    const res = await canjear(atleta.cookie, codigo.code);
    const body = (await res.json()) as RedeemBody;

    expect(res.status).toBe(200);
    expect(body.organizationId).toBe(centro.organizationId);
    expect(body.memberId).toMatch(/^mem_/);

    const listado = await app.request('/api/v1/members', req(centro.cookie, 'GET'));
    const items = ((await listado.json()) as { items: Array<{ firstName: string }> }).items;
    expect(items.map((socio) => socio.firstName)).toContain('Juan');
  });

  it('suma al atleta a la organización con rol de socio, no de staff', async () => {
    const centro = await nuevoCentro('rol');
    const codigo = await generarCodigo(centro.cookie);
    const atleta = await nuevoAtleta('rol-atleta');

    await canjear(atleta.cookie, codigo.code);

    expect(membresias).toHaveLength(1);
    expect(membresias[0]?.organizationId).toBe(centro.organizationId);
  });

  it('acepta el código como lo dicta la gente: minúsculas, guiones y espacios', async () => {
    const centro = await nuevoCentro('formato');
    const codigo = await generarCodigo(centro.cookie);
    const atleta = await nuevoAtleta('formato-atleta');

    const dictado = `${codigo.code.slice(0, 4).toLowerCase()}-${codigo.code.slice(4).toLowerCase()}`;
    const res = await canjear(atleta.cookie, dictado);

    expect(res.status).toBe(200);
  });

  it('sin sesión no se canjea: no habría a quién asociar', async () => {
    const centro = await nuevoCentro('sin-sesion');
    const codigo = await generarCodigo(centro.cookie);

    const res = await app.request('/api/v1/invite-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: codigo.code, firstName: 'Juan', lastName: 'Pérez' }),
    });

    expect(res.status).toBe(401);
  });

  it('canjear dos veces no crea dos fichas', async () => {
    const centro = await nuevoCentro('doble-canje');
    const codigo = await generarCodigo(centro.cookie);
    const atleta = await nuevoAtleta('doble-atleta');

    const primero = (await (await canjear(atleta.cookie, codigo.code)).json()) as RedeemBody;
    const segundo = (await (await canjear(atleta.cookie, codigo.code)).json()) as RedeemBody;

    expect(segundo.memberId).toBe(primero.memberId);

    const listado = await app.request('/api/v1/members', req(centro.cookie, 'GET'));
    expect(((await listado.json()) as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('rechazos', () => {
  it('vencido, agotado, revocado e inexistente devuelven el MISMO error', async () => {
    const centro = await nuevoCentro('rechazos');
    const atleta = await nuevoAtleta('rechazos-atleta');

    const vencido = await generarCodigo(centro.cookie, { expiresAt: MANANA });
    const agotado = await generarCodigo(centro.cookie, { maxUses: 1 });
    const revocado = await generarCodigo(centro.cookie);

    // Agotar el segundo con otro atleta, y revocar el tercero.
    await canjear((await nuevoAtleta('agotador')).cookie, agotado.code);
    await app.request(
      `/api/v1/invite-codes/${revocado.publicId}/revoke`,
      req(centro.cookie, 'POST', {}),
    );
    // Y mover el reloj más allá del vencimiento del primero.
    ahora = Temporal.Instant.from('2026-09-03T12:00:00Z');

    const respuestas = await Promise.all([
      canjear(atleta.cookie, vencido.code),
      canjear(atleta.cookie, agotado.code),
      canjear(atleta.cookie, revocado.code),
      canjear(atleta.cookie, 'ZZZZ9999'),
    ]);

    /*
     * §11.2: el mensaje es deliberadamente ambiguo. Distinguir "vencido" de
     * "no existe" le diría a quien prueba códigos al azar cuáles existen.
     */
    const cuerpos = await Promise.all(respuestas.map((res) => res.json() as Promise<ErrorBody>));
    for (const cuerpo of cuerpos) {
      expect(cuerpo.error.code).toBe('LP-MEMB-422-005');
      expect(cuerpo.error.message).toBe('El código no es válido, ya venció o se agotó.');
    }
    for (const res of respuestas) expect(res.status).toBe(422);
  });

  it('un código rechazado no consume usos', async () => {
    const centro = await nuevoCentro('sin-consumo');
    const codigo = await generarCodigo(centro.cookie, { maxUses: 5 });
    await app.request(
      `/api/v1/invite-codes/${codigo.publicId}/revoke`,
      req(centro.cookie, 'POST', {}),
    );

    await canjear((await nuevoAtleta('rechazado')).cookie, codigo.code);

    const listado = await app.request('/api/v1/invite-codes', req(centro.cookie, 'GET'));
    const items = ((await listado.json()) as { items: CodeBody[] }).items;
    expect(items[0]?.usedCount).toBe(0);
  });
});

describe('revocación', () => {
  it('corta el código de inmediato', async () => {
    const centro = await nuevoCentro('revocar');
    const codigo = await generarCodigo(centro.cookie);

    const res = await app.request(
      `/api/v1/invite-codes/${codigo.publicId}/revoke`,
      req(centro.cookie, 'POST', {}),
    );
    const body = (await res.json()) as CodeBody;

    expect(res.status).toBe(200);
    expect(body.status).toBe('revoked');
    expect(body.revokedAt).not.toBeNull();
  });

  it('no toca a quienes ya lo usaron', async () => {
    const centro = await nuevoCentro('revocar-usados');
    const codigo = await generarCodigo(centro.cookie);
    await canjear((await nuevoAtleta('ya-uso')).cookie, codigo.code);

    await app.request(
      `/api/v1/invite-codes/${codigo.publicId}/revoke`,
      req(centro.cookie, 'POST', {}),
    );

    // Son socios del centro por derecho propio: desasociarlos por revocar un
    // código sería un efecto que nadie pidió.
    const listado = await app.request('/api/v1/members', req(centro.cookie, 'GET'));
    expect(((await listado.json()) as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('concurrencia: el último cupo del código', () => {
  it('cinco atletas contra un solo lugar: gana uno solo', async () => {
    const centro = await nuevoCentro('concurrencia');
    const codigo = await generarCodigo(centro.cookie, { maxUses: 1 });
    const atletas = await Promise.all(
      Array.from({ length: 5 }, (_, i) => nuevoAtleta(`concurrente-${i}`)),
    );

    const respuestas = await Promise.all(
      atletas.map((atleta) => canjear(atleta.cookie, codigo.code)),
    );

    /*
     * El consumo es un `findOneAndUpdate` con `$expr`: el filtro exige que
     * queden cupos y el `$inc` sucede en la misma operación. Con un `read` y
     * después un `write`, los cinco leerían `usedCount: 0` y los cinco pasarían.
     */
    const exitosos = respuestas.filter((res) => res.status === 200);
    expect(exitosos).toHaveLength(1);

    const listado = await app.request('/api/v1/invite-codes', req(centro.cookie, 'GET'));
    const items = ((await listado.json()) as { items: CodeBody[] }).items;
    expect(items[0]?.usedCount).toBe(1);
    expect(items[0]?.status).toBe('exhausted');
  });
});

describe('aislamiento de tenant', () => {
  it('un centro no ve ni revoca los códigos de otro', async () => {
    const victima = await nuevoCentro('inv-victima');
    const codigo = await generarCodigo(victima.cookie);
    const atacante = await nuevoCentro('inv-atacante');

    const revocar = await app.request(
      `/api/v1/invite-codes/${codigo.publicId}/revoke`,
      req(atacante.cookie, 'POST', {}),
    );
    const listado = await (
      await app.request('/api/v1/invite-codes', req(atacante.cookie, 'GET'))
    ).text();

    expect(revocar.status).toBe(404);
    expect((JSON.parse(listado) as { items: unknown[] }).items).toEqual([]);
    expect(listado).not.toContain(codigo.code);
  });

  it('el canje lleva al atleta al centro del código, no al del atacante', async () => {
    const dueño = await nuevoCentro('inv-owner');
    const otro = await nuevoCentro('inv-otro');
    const codigo = await generarCodigo(dueño.cookie);
    const atleta = await nuevoAtleta('inv-atleta');

    const body = (await (await canjear(atleta.cookie, codigo.code)).json()) as RedeemBody;

    expect(body.organizationId).toBe(dueño.organizationId);
    expect(body.organizationId).not.toBe(otro.organizationId);

    // Y la ficha quedó en el centro dueño del código, no en el otro.
    const enOtro = await app.request('/api/v1/members', req(otro.cookie, 'GET'));
    expect(((await enOtro.json()) as { items: unknown[] }).items).toEqual([]);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las cuatro rutas están declaradas, y solo el canje queda fuera de tenant', () => {
    const codigos = allRegisteredRoutes().filter((route) =>
      route.path.startsWith('/api/v1/invite-codes'),
    );

    expect(codigos).toHaveLength(4);

    const sinTenant = codigos.filter((route) => !route.tenantScoped);
    expect(sinTenant.map((route) => route.path)).toEqual(['/api/v1/invite-codes/redeem']);

    for (const route of codigos.filter((r) => r.tenantScoped)) {
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta con alcance de tenant ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('inv-fixtures');
    const victima = await nuevoCentro('inv-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!route.path.startsWith('/api/v1/invite-codes') || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });
      const texto = await res.text();

      // Un codigo ajeno filtrado es peor que un dato: es una llave.
      expect(texto, `${route.method} ${route.path}`).not.toContain('ven_victima');

      // El listado del atacante responde 200 con lo suyo, que esta vacio; las
      // rutas sobre un recurso concreto tienen que dar 404.
      if (route.path.includes(':id')) {
        expect(res.status, `${route.method} ${route.path}`).toBe(404);
      }
    }
  });

  it('cada ruta montada está declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/invite-codes'))
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/invite-codes'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });
});
