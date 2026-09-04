import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { MyContract, MyDataExport, MyProfile } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createInMemoryObjectStorage } from '../src/modules/account/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-29. Lo del socio sobre lo suyo (§2.1.2, §9.2).
 *
 * Lo que se verifica y no se negocia: que **ninguna de estas rutas acepte un
 * `memberId`** — si lo aceptara, un socio leería el perfil del compañero de al
 * lado y el aislamiento por tenant no lo taparía —, que la foto se valide por
 * **bytes** y no por extensión, y que el enlace a la foto **venza**.
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

/** El almacenamiento del test: en memoria, con la misma firma que el real. */
const storage = createInMemoryObjectStorage('secreto-de-test', () => ahora);

type ErrorBody = { success: false; error: { code: string; message: string } };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

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

async function post<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

async function centroListo(nombre: string) {
  const centro = await nuevoCentro(nombre);
  const sede = await post<{ publicId: string }>(centro.cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

  return { ...centro, venueId: sede.publicId };
}

type Centro = Awaited<ReturnType<typeof centroListo>>;

/** Un socio con cuenta propia: es quien usa estas rutas. */
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

async function darPack(centro: Centro, memberId: string, durationDays = 30, credits = 8) {
  const producto = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
    name: 'Pack 8 clases',
    type: 'class_pack',
    priceCents: 6_000_000,
    credits,
    durationDays,
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

/** Sube una foto con el cuerpo crudo, que es como llega de verdad. */
const subirFoto = (cookie: string, bytes: Uint8Array) =>
  app.request('/api/v1/my/avatar', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/octet-stream' },
    body: bytes,
  });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_account_test' });
  for (const migration of migrations) await migration.up(mongoose.connection.db as Db);

  auth = createAuth({
    db: mongoose.connection.db as Db,
    secret: 'un-secreto-de-test-de-al-menos-32-caracteres',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:5175'],
    emailSender,
    rateLimitEnabled: false,
  });

  app = createApp({
    logger,
    corsOrigins: ['http://localhost:5175'],
    auth,
    modules: createModules({
      events: createEventBus(logger),
      entitlements,
      logger,
      now: () => ahora,
      storage,
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

beforeEach(async () => {
  ahora = AHORA;
  entitlements.invalidateAll();
  for (const coleccion of [
    'members',
    'venues',
    'contracts',
    'products',
    'bookings',
    'consents',
    'legalDocuments',
  ]) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('mis packs (§2.1.2)', () => {
  it('🔴 muestra qué le queda y hasta cuándo', async () => {
    const centro = await centroListo('packs');
    const socio = await atletaDe(centro, 'Micaela');
    await darPack(centro, socio.memberId, 30, 8);

    const res = await app.request('/api/v1/my/contracts', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyContract[];

    expect(res.status).toBe(200);
    expect(body[0]?.productName).toBe('Pack 8 clases');
    expect(body[0]?.creditsLeft).toBe(8);
    expect(body[0]?.creditsTotal).toBe(8);
    expect(body[0]?.daysLeft).toBe(30);
    expect(body[0]?.expiringSoon).toBe(false);
  });

  it('🔴 destaca el que vence esta semana: es cuando hay que renovar', async () => {
    const centro = await centroListo('packs-vencen');
    const socio = await atletaDe(centro, 'Micaela');
    await darPack(centro, socio.memberId, 5);

    const res = await app.request('/api/v1/my/contracts', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyContract[];

    expect(body[0]?.expiringSoon).toBe(true);
    expect(body[0]?.daysLeft).toBe(5);
  });

  it('el pack agotado se sigue mostrando: "no te queda ninguna" es una respuesta', async () => {
    const centro = await centroListo('packs-agotado');
    const socio = await atletaDe(centro, 'Micaela');
    const contractId = await darPack(centro, socio.memberId, 30, 1);
    await mongoose.connection.db
      ?.collection('contracts')
      .updateOne({ publicId: contractId }, { $set: { creditsUsed: 1, status: 'exhausted' } });

    const res = await app.request('/api/v1/my/contracts', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyContract[];

    expect(body).toHaveLength(1);
    expect(body[0]?.creditsLeft).toBe(0);
    expect(body[0]?.expiringSoon).toBe(false);
  });

  it('🔴 la clase suelta no vence: no inventa una fecha', async () => {
    /*
     * Un `drop_in` no lleva `durationDays`, así que no tiene vencimiento.
     * Mostrar "vence hoy" o una fecha cualquiera sería peor que decir que no
     * vence: el socio dejaría de usar algo que todavía puede usar.
     */
    const centro = await centroListo('packs-sin-vencimiento');
    const socio = await atletaDe(centro, 'Micaela');
    const suelta = await post<{ publicId: string }>(centro.cookie, '/api/v1/products', {
      name: 'Clase suelta',
      type: 'drop_in',
      priceCents: 800_000,
      credits: 1,
      venueIds: [centro.venueId],
    });
    const contrato = await post<{ publicId: string }>(centro.cookie, '/api/v1/contracts', {
      memberId: socio.memberId,
      productId: suelta.publicId,
      venueId: centro.venueId,
    });
    await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/activate`, {});

    const res = await app.request('/api/v1/my/contracts', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyContract[];

    expect(body[0]?.endsAt).toBeNull();
    expect(body[0]?.daysLeft).toBeNull();
    expect(body[0]?.expiringSoon).toBe(false);
  });

  it('🔴 el socio ve los suyos, no los del compañero', async () => {
    /*
     * Ninguna de estas rutas acepta un `memberId`: se resuelve desde la sesión.
     * Es la única forma de que un socio no pueda pedir lo de otro del mismo
     * centro — el aislamiento por tenant no lo taparía.
     */
    const centro = await centroListo('packs-ajenos');
    const micaela = await atletaDe(centro, 'Micaela');
    await darPack(centro, micaela.memberId);
    const julian = await atletaDe(centro, 'Julian');

    const res = await app.request(
      `/api/v1/my/contracts?memberId=${micaela.memberId}`,
      req(julian.cookie, 'GET'),
    );

    expect((await res.json()) as MyContract[]).toEqual([]);
  });
});

describe('mi perfil', () => {
  it('trae los datos propios y todavía sin foto', async () => {
    const centro = await centroListo('perfil');
    const socio = await atletaDe(centro, 'Micaela');

    const res = await app.request('/api/v1/my/profile', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyProfile;

    expect(body.fullName).toBe('Micaela Socio');
    expect(body.avatarUrl).toBeNull();
  });

  it('guarda el teléfono y el contacto de emergencia', async () => {
    const centro = await centroListo('perfil-editar');
    const socio = await atletaDe(centro, 'Micaela');

    const res = await app.request(
      '/api/v1/my/profile',
      req(socio.cookie, 'PATCH', {
        phone: '+542914567890',
        emergencyContact: { fullName: 'Ana Sosa', phone: '+542914000000', relationship: 'hermana' },
      }),
    );
    const body = (await res.json()) as MyProfile;

    expect(res.status).toBe(200);
    expect(body.phone).toBe('+542914567890');
    expect(body.emergencyContact?.fullName).toBe('Ana Sosa');
  });

  it('sin ficha en el centro, lo dice con qué hacer', async () => {
    const centro = await centroListo('perfil-sin-ficha');

    const res = await app.request('/api/v1/my/profile', req(centro.cookie, 'GET'));
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('LP-MEMB-404-003');
  });
});

describe('la foto de perfil (§2.1.2)', () => {
  it('acepta una imagen de verdad y devuelve un enlace que vence', async () => {
    const centro = await centroListo('foto');
    const socio = await atletaDe(centro, 'Micaela');

    const res = await subirFoto(socio.cookie, PNG);
    const body = (await res.json()) as { avatarUrl: string; expiresAt: string };

    expect(res.status).toBe(200);
    // 🔴 Firmada y con vencimiento, no una URL pública permanente.
    expect(body.avatarUrl).toContain('sig=');
    expect(body.expiresAt).toBe('2026-03-02T12:15:00Z');
  });

  it('🔴 un SVG renombrado NO pasa: el tipo sale de los bytes', async () => {
    const centro = await centroListo('foto-svg');
    const socio = await atletaDe(centro, 'Micaela');
    const svg = new TextEncoder().encode('<svg onload="robar()"></svg>');

    const res = await subirFoto(socio.cookie, svg);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-ACCT-422-001');
  });

  it('🔴 la que pesa de más se rechaza antes de guardarla', async () => {
    const centro = await centroListo('foto-grande');
    const socio = await atletaDe(centro, 'Micaela');
    const enorme = new Uint8Array(3 * 1024 * 1024);
    enorme.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const res = await subirFoto(socio.cookie, enorme);
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(413);
    expect(body.error.code).toBe('LP-ACCT-413-002');
  });

  it('la foto queda en el perfil, con su enlace firmado', async () => {
    const centro = await centroListo('foto-perfil');
    const socio = await atletaDe(centro, 'Micaela');
    await subirFoto(socio.cookie, PNG);

    const res = await app.request('/api/v1/my/profile', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyProfile;

    expect(body.avatarUrl).toContain('sig=');
  });

  it('🔴 el enlace vencido no sirve más', async () => {
    const centro = await centroListo('foto-vencida');
    const socio = await atletaDe(centro, 'Micaela');
    const subida = await subirFoto(socio.cookie, PNG);
    const { avatarUrl } = (await subida.json()) as { avatarUrl: string };
    const clave = decodeURIComponent(avatarUrl.split('/files/')[1]?.split('?')[0] ?? '');
    const parametros = new URLSearchParams(avatarUrl.split('?')[1] ?? '');

    // Veinte minutos después: el enlace duraba quince.
    ahora = AHORA.add({ minutes: 20 });

    expect(() =>
      storage.read(clave, `${parametros.get('expires') ?? ''}:${parametros.get('sig') ?? ''}`),
    ).toThrow(/venció/);
  });

  it('una firma falsificada tampoco', async () => {
    const centro = await centroListo('foto-firma');
    const socio = await atletaDe(centro, 'Micaela');
    const subida = await subirFoto(socio.cookie, PNG);
    const { avatarUrl } = (await subida.json()) as { avatarUrl: string };
    const clave = decodeURIComponent(avatarUrl.split('/files/')[1]?.split('?')[0] ?? '');
    const expires = new URLSearchParams(avatarUrl.split('?')[1] ?? '').get('expires') ?? '';

    expect(() => storage.read(clave, `${expires}:firma-inventada`)).toThrow();
  });
});

describe('los derechos sobre mis datos (§9.2, Ley 25.326)', () => {
  it('🔴 el export trae todo lo suyo, no un resumen elegido por nosotros', async () => {
    const centro = await centroListo('export');
    const socio = await atletaDe(centro, 'Micaela');
    await darPack(centro, socio.memberId);
    await post(centro.cookie, '/api/v1/legal-documents', {
      type: 'liability_waiver',
      title: 'Deslinde',
      contentHtml: '<p>Firmo.</p>',
      required: true,
    });
    const pendientes = await app.request(
      '/api/v1/legal-documents/pending',
      req(socio.cookie, 'GET'),
    );
    const [documento] = (await pendientes.json()) as Array<{ publicId: string }>;
    await post(socio.cookie, `/api/v1/legal-documents/${documento?.publicId}/accept`, {});

    const res = await app.request('/api/v1/my/data', req(socio.cookie, 'GET'));
    const body = (await res.json()) as MyDataExport;

    expect(res.status).toBe(200);
    expect(body.profile.fullName).toBe('Micaela Socio');
    expect(body.contracts).toHaveLength(1);
    expect(body.consents).toHaveLength(1);
    expect(body.consents[0]?.documentType).toBe('liability_waiver');
    expect(body.exportedAt).toBe('2026-03-02T12:00:00Z');
  });

  it('🔴 pedir la baja NO borra: deja la fecha y el plazo de 90 días', async () => {
    /*
     * El centro tiene obligaciones sobre lo firmado y lo cobrado: borrar en el
     * acto las incumpliría. Queda la fecha, que es lo que hace exigible el
     * plazo (ADR-004, decisión 10).
     */
    const centro = await centroListo('baja');
    const socio = await atletaDe(centro, 'Micaela');

    const res = await app.request(
      '/api/v1/my/deletion-request',
      req(socio.cookie, 'POST', { reason: 'Me mudo de ciudad.' }),
    );
    const body = (await res.json()) as { requestedAt: string; purgeAfter: string };

    expect(res.status).toBe(200);
    expect(body.purgeAfter).toBe('2026-05-31T12:00:00Z');

    const ficha = await mongoose.connection.db
      ?.collection('members')
      .findOne<{ deletionRequestedAt: Date; deletionReason: string }>({
        publicId: socio.memberId,
      });

    // La ficha sigue ahí, con la baja pedida.
    expect(ficha).not.toBeNull();
    expect(ficha?.deletionReason).toBe('Me mudo de ciudad.');
  });
});
