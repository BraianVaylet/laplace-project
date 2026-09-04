import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { OnboardingProgress, Subscription } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-30. El asistente de primeros pasos (§2.1.3).
 *
 * 🔴 Lo que se verifica acá es que **el progreso sale del estado real del
 * centro**. Un checklist auto-declarado marca "clase publicada" sin que exista
 * una clase, y el SMU se entera cuando un socio abre la app y no hay nada.
 *
 * Por eso ningún test de este archivo marca un paso: crea la cosa por la API
 * y después mira el progreso.
 */
const require = createRequire(import.meta.url);
const migrations = [
  require('../../../migrations/20260901120000-mandatory-indexes.cjs'),
  require('../../../migrations/20260902150000-session-materialization-unique.cjs'),
  require('../../../migrations/20260902160000-venue-closures.cjs'),
  require('../../../migrations/20260902170000-booking-unique.cjs'),
  // Siembra el catálogo de planes: sin plan no hay alta que valga.
  require('../../../migrations/20260906090000-subscriptions.cjs'),
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

const ALTA = Temporal.Instant.from('2026-03-02T21:00:00Z');
let ahora = ALTA;

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

async function post<T>(cookie: string, path: string, body: unknown): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

let creados = 0;

/** El camino de la landing: se registra y da de alta su centro. Sin tarjeta. */
async function nuevoSuscriptor(nombre: string) {
  const n = ++creados;
  const cookie = await signUp(`${nombre}-${n}@laplace.test`);

  const suscripcion = await post<Subscription>(cookie, '/api/v1/subscribers', {
    centerName: `Box ${nombre} ${n}`,
    slug: `${nombre}-${n}`,
  });

  await app.request(
    '/api/v1/auth/organization/set-active',
    req(cookie, 'POST', { organizationId: suscripcion.organizationId }),
  );

  return { cookie, organizationId: suscripcion.organizationId };
}

const progresoDe = async (cookie: string): Promise<OnboardingProgress> => {
  const res = await app.request('/api/v1/subscription/onboarding', req(cookie, 'GET'));
  if (res.status !== 200) throw new Error(`onboarding falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as OnboardingProgress;
};

const pasoDe = (progreso: OnboardingProgress, id: string) =>
  progreso.steps.find((paso) => paso.id === id);

/** Crear la sede: el primer paso, y el que destraba todos los demás. */
const crearSede = (cookie: string) =>
  post<{ publicId: string }>(cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  });

async function crearClase(cookie: string, venueId: string) {
  const salas = (await (
    await app.request(`/api/v1/rooms?venueId=${venueId}`, req(cookie, 'GET'))
  ).json()) as { items: Array<{ publicId: string }> };

  return post(cookie, '/api/v1/class-templates', {
    venueId,
    roomId: salas.items[0]?.publicId,
    name: 'Funcional',
    categoryId: 'funcional',
    durationMin: 60,
    capacity: 12,
    recurrence: {
      freq: 'weekly',
      byWeekday: [1, 3, 5],
      timeOfDay: '19:00',
      interval: 1,
      from: '2026-03-03',
    },
  });
}

const crearProducto = (cookie: string, venueId: string) =>
  post(cookie, '/api/v1/products', {
    name: 'Pack 8 clases',
    type: 'class_pack',
    priceCents: 6_000_000,
    credits: 8,
    durationDays: 30,
    venueIds: [venueId],
  });

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_onboarding_test' });
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
      organizations: {
        create: async ({ name, slug, ownerUserId }) => {
          const org = await auth.api.createOrganization({
            body: { name, slug, userId: ownerUserId },
          });

          return { organizationId: (org as { id: string }).id };
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
  ahora = ALTA;
  entitlements.invalidateAll();
});

describe('el centro recién dado de alta', () => {
  it('🔴 arranca en cero: nadie marcó nada porque no hay nada', async () => {
    const { cookie } = await nuevoSuscriptor('vacio');

    const progreso = await progresoDe(cookie);

    expect(progreso.percent).toBe(0);
    expect(progreso.currentStep).toBe('venue');
    expect(progreso.completedAt).toBeNull();
  });

  it('los cinco pasos vienen con su título y a dónde van', async () => {
    const { cookie } = await nuevoSuscriptor('pasos');

    const progreso = await progresoDe(cookie);

    expect(progreso.steps.map((paso) => paso.id)).toEqual([
      'venue',
      'hours',
      'class',
      'product',
      'invite',
    ]);
    expect(pasoDe(progreso, 'class')?.href).toBe('/horario');
  });

  it('🔴 lo que necesita una sede se muestra trabado, no se deja tocar y fallar', async () => {
    const { cookie } = await nuevoSuscriptor('trabado');

    const progreso = await progresoDe(cookie);

    expect(pasoDe(progreso, 'class')?.blocked).toBe(true);
    expect(pasoDe(progreso, 'venue')?.blocked).toBe(false);
  });
});

describe('🔴 el progreso sale del estado real, no de lo declarado', () => {
  it('crear la sede de verdad mueve la barra y destraba el resto', async () => {
    const { cookie } = await nuevoSuscriptor('sede');

    await crearSede(cookie);
    const progreso = await progresoDe(cookie);

    expect(pasoDe(progreso, 'venue')?.done).toBe(true);
    expect(pasoDe(progreso, 'class')?.blocked).toBe(false);
    expect(progreso.percent).toBe(20);
  });

  it('publicar una clase y crear un producto termina el asistente', async () => {
    const { cookie } = await nuevoSuscriptor('completo');
    const sede = await crearSede(cookie);

    await crearClase(cookie, sede.publicId);
    await crearProducto(cookie, sede.publicId);
    const progreso = await progresoDe(cookie);

    expect(pasoDe(progreso, 'class')?.done).toBe(true);
    expect(pasoDe(progreso, 'product')?.done).toBe(true);
    expect(progreso.completedAt).not.toBeNull();
    // Terminado no es lo mismo que completo: los dos opcionales siguen ahí, y
    // el asistente sigue ofreciendo el que viene primero.
    expect(progreso.currentStep).toBe('hours');
  });

  it('🔴 saltear no completa: la barra no se mueve', async () => {
    // Si saltear marcara hecho, un centro vacío llegaría al 100%.
    const { cookie } = await nuevoSuscriptor('salteado');

    const progreso = await post<OnboardingProgress>(
      cookie,
      '/api/v1/subscription/onboarding/invite/skip',
      {},
    );

    expect(pasoDe(progreso, 'invite')?.skipped).toBe(true);
    expect(pasoDe(progreso, 'invite')?.done).toBe(false);
    expect(progreso.percent).toBe(0);
  });
});

describe('el progreso persiste (§2.1.3)', () => {
  it('🔴 se va y vuelve, y lo salteado sigue salteado', async () => {
    // La barra no puede depender de la pestaña abierta: el SMU se va, vuelve
    // al día siguiente y tiene que encontrar el asistente donde lo dejó.
    const { cookie } = await nuevoSuscriptor('persistente');
    await post(cookie, '/api/v1/subscription/onboarding/hours/skip', {});

    const progreso = await progresoDe(cookie);

    expect(pasoDe(progreso, 'hours')?.skipped).toBe(true);
  });

  it('volver a un paso salteado lo devuelve al camino', async () => {
    const { cookie } = await nuevoSuscriptor('retomado');
    await crearSede(cookie);
    await post(cookie, '/api/v1/subscription/onboarding/hours/skip', {});
    expect((await progresoDe(cookie)).currentStep).toBe('class');

    const progreso = await post<OnboardingProgress>(
      cookie,
      '/api/v1/subscription/onboarding/hours/resume',
      {},
    );

    expect(pasoDe(progreso, 'hours')?.skipped).toBe(false);
    expect(progreso.currentStep).toBe('hours');
  });

  it('un paso inventado en la URL no se guarda', async () => {
    const { cookie } = await nuevoSuscriptor('inventado');

    const res = await app.request(
      '/api/v1/subscription/onboarding/lo-que-sea/skip',
      req(cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
  });
});

describe('🔴 el time-to-first-class de §2.0', () => {
  it('se mide de verdad: del alta a la primera clase publicada', async () => {
    /*
     * La métrica del producto es "menos de 30 minutos". Sin el número medido
     * es una promesa que nadie verifica, y este es el único lugar donde se
     * puede medir sin pedirle nada al usuario.
     */
    const { cookie } = await nuevoSuscriptor('cronometro');
    const sede = await crearSede(cookie);

    ahora = ALTA.add({ minutes: 22 });
    await crearClase(cookie, sede.publicId);

    const progreso = await progresoDe(cookie);

    expect(progreso.timeToFirstClassMinutes).toBe(22);
  });

  it('sin clase todavía no hay número que informar', async () => {
    const { cookie } = await nuevoSuscriptor('sin-clase');

    expect((await progresoDe(cookie)).timeToFirstClassMinutes).toBeNull();
  });

  it('🔴 el número no se mueve después: se sella la primera vez', async () => {
    // Si se recalculara con el reloj de cada consulta, la métrica diría lo que
    // tardó en abrir la pantalla, no lo que tardó en publicar la clase.
    const { cookie } = await nuevoSuscriptor('sellado');
    const sede = await crearSede(cookie);

    ahora = ALTA.add({ minutes: 12 });
    await crearClase(cookie, sede.publicId);
    await progresoDe(cookie);

    ahora = ALTA.add({ hours: 30 });
    expect((await progresoDe(cookie)).timeToFirstClassMinutes).toBe(12);
  });
});

describe('🔴 terminar el onboarding es un hecho, no un estado', () => {
  it('borrar el producto después no revive el asistente', async () => {
    /*
     * El SMU archiva su único producto tres meses más tarde. El asistente de
     * primeros pasos no puede volver a aparecer como si recién se hubiera
     * registrado: ya arrancó, y eso ya pasó.
     */
    const { cookie } = await nuevoSuscriptor('terminado');
    const sede = await crearSede(cookie);
    await crearClase(cookie, sede.publicId);
    const producto = await post<{ publicId: string }>(cookie, '/api/v1/products', {
      name: 'Pack 8 clases',
      type: 'class_pack',
      priceCents: 6_000_000,
      credits: 8,
      durationDays: 30,
      venueIds: [sede.publicId],
    });
    const terminadoEn = (await progresoDe(cookie)).completedAt;
    expect(terminadoEn).not.toBeNull();

    await app.request(`/api/v1/products/${producto.publicId}`, req(cookie, 'DELETE'));

    expect((await progresoDe(cookie)).completedAt).toBe(terminadoEn);
  });
});

describe('aislamiento', () => {
  it('🔴 el progreso es el del centro de la sesión, no el de otro', async () => {
    const uno = await nuevoSuscriptor('centro-uno');
    await crearSede(uno.cookie);
    const otro = await nuevoSuscriptor('centro-dos');

    expect((await progresoDe(uno.cookie)).percent).toBe(20);
    expect((await progresoDe(otro.cookie)).percent).toBe(0);
  });
});
