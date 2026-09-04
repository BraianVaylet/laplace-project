import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { MemberOverview, MemberResponse } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-06. La ficha 360 del socio (§2.1.7): la pantalla más usada del DFSM.
 *
 * 🔴 Lo que no se negocia es **quién ve plata**. El coach abre esta pantalla
 * todos los días para saber si alguien puede entrenar; cuánto debe no es asunto
 * suyo (§2.1.12). Y se verifica **desde la API**: que el front lo esconda no
 * sirve de nada si el dato viajó en la respuesta.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902150000-session-materialization-unique.cjs'),
  require('../../../migrations/20260902160000-venue-closures.cjs'),
  require('../../../migrations/20260902170000-booking-unique.cjs'),
  require('../../../migrations/20260904090000-waivers-unique.cjs'),
] as Array<{ up(db: Db): Promise<void> }>;

let replSet: MongoMemoryReplSet;
let auth: Auth;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const emailSender: EmailSender = {
  sendVerification: () => Promise.resolve(),
  sendMagicLink: () => Promise.resolve(),
};
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'pro' }));

const AHORA = Temporal.Instant.from('2026-03-02T12:00:00Z');
let ahora = AHORA;

const req = (cookie: string, method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

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

async function post<T>(cookie: string, path: string, body: unknown, clave?: string): Promise<T> {
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      // §5.0: reservas, pagos y check-in exigen clave de idempotencia.
      ...(clave ? { 'Idempotency-Key': clave } : {}),
    },
    body: JSON.stringify(body),
  });
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

let creados = 0;

async function centroListo(nombre: string) {
  const n = ++creados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);

  const res = await app.request('/api/v1/auth/organization/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: `Centro ${nombre} ${n}`, slug: `${nombre}-${n}` }),
  });
  if (res.status !== 200) throw new Error(`create org falló: ${res.status} ${await res.text()}`);

  const org = (await res.json()) as { id: string };
  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: org.id }),
  );

  const sede = await post<{ publicId: string }>(cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const salas = (await (
    await app.request(`/api/v1/rooms?venueId=${sede.publicId}`, req(cookie, 'GET'))
  ).json()) as { items: Array<{ publicId: string }> };

  return {
    cookie,
    organizationId: org.id,
    venueId: sede.publicId,
    roomId: salas.items[0]?.publicId ?? '',
  };
}

type Centro = Awaited<ReturnType<typeof centroListo>>;
type OrgRole = 'owner' | 'manager_assistant' | 'head_coach' | 'coach' | 'front_desk';

/** Un usuario del staff con el rol pedido y su sesión propia. */
async function staffDe(centro: Centro, role: OrgRole) {
  const cookie = await signUp(`${role}-ficha-${++creados}@laplace.test`);
  const sesion = (await auth.api.getSession({ headers: { cookie } })) as { user: { id: string } };
  await auth.api.addMember({
    body: { userId: sesion.user.id, organizationId: centro.organizationId, role },
  });
  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: centro.organizationId }),
  );

  return cookie;
}

async function socioDe(centro: Centro, nombre: string) {
  const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    venueIds: [centro.venueId],
    firstName: nombre,
    lastName: 'Socio',
  });

  return socio.publicId;
}

/** Un socio con cuenta propia: solo así puede firmar algo. */
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
  return post<{ publicId: string; version: number }>(centro.cookie, '/api/v1/legal-documents', {
    type: 'liability_waiver',
    title: 'Deslinde de responsabilidad',
    contentHtml: '<p>Entreno bajo mi propia responsabilidad.</p>',
    required: true,
    ...overrides,
  });
}

async function packPara(centro: Centro, memberId: string, credits = 8) {
  const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
    name: `Pack ${credits} clases`,
    type: 'class_pack',
    priceCents: 6_000_000,
    credits,
    durationDays: 30,
    venueIds: [centro.venueId],
  });
  const contrato = await post<{ publicId: string }>(centro.cookie, '/api/v1/contracts', {
    memberId,
    productId: producto.publicId,
    venueId: centro.venueId,
  });
  await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/activate`, {});

  return contrato.publicId;
}

async function claseEn(centro: Centro, cuando: Temporal.Instant) {
  return post<{ publicId: string }>(centro.cookie, '/api/v1/sessions', {
    venueId: centro.venueId,
    roomId: centro.roomId,
    name: 'Funcional',
    categoryId: 'funcional',
    startAt: cuando.toString(),
    durationMin: 60,
    capacity: 12,
  });
}

const fichaDe = async (cookie: string, memberId: string) => {
  const res = await app.request(`/api/v1/members/${memberId}/overview`, req(cookie, 'GET'));

  return { res, body: (await res.json()) as MemberOverview };
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_ficha_test' });
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
    modules: createModules({
      events: createEventBus(logger),
      entitlements,
      logger,
      now: () => ahora,
      memberships: {
        add: async ({ userId, organizationId }) => {
          await auth.api.addMember({ body: { userId, organizationId, role: 'member' } });
        },
      },
    }).routes,
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(() => {
  ahora = AHORA;
  entitlements.invalidateAll();
});

describe('todo lo del socio en una sola respuesta (§2.1.7)', () => {
  it('trae contratos, próximas reservas, asistencia y waivers', async () => {
    const centro = await centroListo('ficha');
    const memberId = await socioDe(centro, 'Micaela');
    await packPara(centro, memberId);
    const clase = await claseEn(centro, ahora.add({ hours: 6 }));
    await post(
      centro.cookie,
      '/api/v1/bookings',
      { sessionId: clase.publicId, memberId },
      `ficha-${memberId}`,
    );

    const { res, body } = await fichaDe(centro.cookie, memberId);

    expect(res.status).toBe(200);
    expect(body.contracts).toHaveLength(1);
    expect(body.contracts[0]?.creditsLeft).toBe(7);
    expect(body.upcomingBookings).toHaveLength(1);
    expect(body.upcomingBookings[0]?.className).toBe('Funcional');
    expect(body.attendance.windowDays).toBe(90);
  });

  it('🔴 no viene ningún dato de plata en el agregado', async () => {
    /*
     * Ni saldo ni deuda ni cargos. El estado de cuenta tiene su propio endpoint
     * con su propio permiso: si viviera acá, cualquiera con `athlete:read` —el
     * coach incluido— se lo llevaría de arriba.
     */
    const centro = await centroListo('sin-plata');
    const memberId = await socioDe(centro, 'Julián');

    const { body } = await fichaDe(centro.cookie, memberId);

    expect(JSON.stringify(body)).not.toMatch(/balance|debt|Cents|overdue/i);
  });

  it('la membresía no cuenta clases', async () => {
    const centro = await centroListo('membresia');
    const memberId = await socioDe(centro, 'Ana');
    const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
      name: 'Libre mensual',
      type: 'membership_unlimited',
      priceCents: 8_500_000,
      durationDays: 30,
      venueIds: [centro.venueId],
    });
    const contrato = await post<{ publicId: string }>(centro.cookie, '/api/v1/contracts', {
      memberId,
      productId: producto.publicId,
      venueId: centro.venueId,
    });
    await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/activate`, {});

    const { body } = await fichaDe(centro.cookie, memberId);

    expect(body.contracts[0]?.creditsLeft).toBeNull();
    expect(body.contracts[0]?.creditsTotal).toBeNull();
  });

  it('un socio recién dado de alta trae todo vacío, no un error', async () => {
    const centro = await centroListo('nuevo');
    const memberId = await socioDe(centro, 'Recién');

    const { res, body } = await fichaDe(centro.cookie, memberId);

    expect(res.status).toBe(200);
    expect(body.contracts).toEqual([]);
    expect(body.upcomingBookings).toEqual([]);
    expect(body.attendance.attended).toBe(0);
    // Nunca vino no es lo mismo que vino hoy.
    expect(body.attendance.daysSinceLastVisit).toBeNull();
  });

  it('la ficha de alguien que no existe da 404', async () => {
    const centro = await centroListo('inexistente');

    const { res } = await fichaDe(centro.cookie, 'mem_no_existe');

    expect(res.status).toBe(404);
  });
});

describe('lo que firmó (§2.1.20)', () => {
  it('el waiver firmado se ve con su versión y su fecha', async () => {
    const centro = await centroListo('firmas');
    const socio = await atletaDe(centro, 'Micaela');
    const doc = await publicar(centro);
    await post(socio.cookie, `/api/v1/legal-documents/${doc.publicId}/accept`, {});

    const { body } = await fichaDe(centro.cookie, socio.memberId);

    expect(body.waivers).toHaveLength(1);
    expect(body.waivers[0]?.title).toBe('Deslinde de responsabilidad');
    expect(body.waivers[0]?.outdated).toBe(false);
  });

  it('🔴 si el centro publicó una versión nueva, lo firmado queda marcado', async () => {
    /*
     * "Firmó el reglamento" y "firmó **este** reglamento" son cosas distintas,
     * y la diferencia es exactamente la que importa el día que alguien reclama.
     */
    const centro = await centroListo('firmas-viejas');
    const socio = await atletaDe(centro, 'Julian');
    const v1 = await publicar(centro);
    await post(socio.cookie, `/api/v1/legal-documents/${v1.publicId}/accept`, {});
    await publicar(centro, { contentHtml: '<p>Versión 2, con la cláusula nueva.</p>' });

    const { body } = await fichaDe(centro.cookie, socio.memberId);

    expect(body.waivers[0]?.outdated).toBe(true);
  });

  it('el socio sin cuenta en la app no tiene firmas digitales', async () => {
    // Lo dado de alta por el mostrador todavía no vinculó usuario: no hay
    // ningún consentimiento que mirar, y eso no es un error.
    const centro = await centroListo('sin-cuenta');
    const memberId = await socioDe(centro, 'Ana');
    await publicar(centro);

    const { body } = await fichaDe(centro.cookie, memberId);

    expect(body.waivers).toEqual([]);
  });
});

describe('la asistencia de los últimos 90 días', () => {
  it('cuenta lo que ocurrió y lo de antes de la ventana queda afuera', async () => {
    const centro = await centroListo('asistencia');
    const memberId = await socioDe(centro, 'Micaela');
    await packPara(centro, memberId);

    // Una clase de hoy, a la que entra.
    const hoy = await claseEn(centro, ahora.add({ minutes: 20 }));
    const reserva = await post<{ booking: { publicId: string } }>(
      centro.cookie,
      '/api/v1/bookings',
      { sessionId: hoy.publicId, memberId },
      `asistencia-${memberId}`,
    );
    const entrada = await app.request(`/api/v1/bookings/${reserva.booking.publicId}/check-in`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: centro.cookie,
        'Idempotency-Key': `ficha-${reserva.booking.publicId}`,
      },
      body: JSON.stringify({ method: 'staff' }),
    });
    expect(entrada.status, await entrada.text()).toBe(200);

    const { body } = await fichaDe(centro.cookie, memberId);

    expect(body.attendance.attended).toBe(1);
    expect(body.attendance.daysSinceLastVisit).toBe(0);
    expect(body.attendance.lastAttendanceAt).not.toBeNull();
  });
});

describe('🔴 quién ve plata (§2.1.12)', () => {
  it('el coach no recibe el estado de cuenta: le contesta 403', async () => {
    // Se prueba en la API, no en la pantalla. Un front que esconde un dato que
    // igual viajó no esconde nada: está en la respuesta y en cualquier `curl`.
    const centro = await centroListo('coach-cuenta');
    const memberId = await socioDe(centro, 'Micaela');
    const coach = await staffDe(centro, 'coach');

    const res = await app.request(`/api/v1/members/${memberId}/statement`, req(coach, 'GET'));

    expect(res.status).toBe(403);
  });

  it('🔴 el coach tampoco recibe el saldo en la ficha del socio', async () => {
    /*
     * `balanceCents` viajaba en la respuesta de `GET /members/:id`, que solo
     * pide `athlete:read` — el permiso que el coach necesita para trabajar. La
     * deuda se le colaba sin que nadie la pidiera.
     */
    const centro = await centroListo('coach-saldo');
    const memberId = await socioDe(centro, 'Micaela');
    const coach = await staffDe(centro, 'coach');

    const res = await app.request(`/api/v1/members/${memberId}`, req(coach, 'GET'));
    const body = (await res.json()) as MemberResponse;

    expect(res.status).toBe(200);
    expect(body.firstName).toBe('Micaela');
    expect(body.balanceCents).toBeNull();
  });

  it('tampoco en el listado, que es donde se ve a todos juntos', async () => {
    const centro = await centroListo('coach-listado');
    await socioDe(centro, 'Micaela');
    const coach = await staffDe(centro, 'coach');

    const res = await app.request('/api/v1/members', req(coach, 'GET'));
    const body = (await res.json()) as { items: MemberResponse[] };

    expect(body.items).not.toHaveLength(0);
    for (const socio of body.items) expect(socio.balanceCents).toBeNull();
  });

  it('el mostrador sí lo ve: cobra, y para cobrar necesita saber cuánto', async () => {
    const centro = await centroListo('mostrador');
    const memberId = await socioDe(centro, 'Micaela');
    const frontDesk = await staffDe(centro, 'front_desk');

    const res = await app.request(`/api/v1/members/${memberId}`, req(frontDesk, 'GET'));
    const body = (await res.json()) as MemberResponse;

    expect(body.balanceCents).toBe(0);
  });

  it('el coach sí abre la ficha 360: es su pantalla de trabajo', async () => {
    // Lo que le falta es un dato, no la pantalla.
    const centro = await centroListo('coach-ficha');
    const memberId = await socioDe(centro, 'Micaela');
    await packPara(centro, memberId);
    const coach = await staffDe(centro, 'coach');

    const { res, body } = await fichaDe(coach, memberId);

    expect(res.status).toBe(200);
    expect(body.contracts).toHaveLength(1);
  });
});

describe('aislamiento de tenant', () => {
  it('🔴 la ficha de un socio de otro centro no existe', async () => {
    const propio = await centroListo('propio');
    const ajeno = await centroListo('ajeno');
    const memberId = await socioDe(ajeno, 'DelOtroCentro');

    const { res } = await fichaDe(propio.cookie, memberId);

    // 404 y no 403: un 403 confirmaría que ese socio existe (ADR-000).
    expect(res.status).toBe(404);
  });
});
