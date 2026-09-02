import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { createModules } from '../src/modules/index.js';
import { VICTIM_CONTRACT_PRODUCT } from '../src/modules/contracts/infrastructure/routes.js';
import { createLogger } from '../src/observability/logger.js';
import { runWithTenant } from '../src/tenancy/context.js';

/**
 * F1-08. La instancia comprada por un socio. Acá vive la regla más delicada del
 * producto: el orden de consumo cuando hay varios contratos activos (§2.1.9).
 *
 * Lo que se verifica y no se negocia: el consumo **atómico** (N simultáneos
 * sobre 1 crédito → gana exactamente 1), el orden FIFO explicable, la máquina de
 * estados completa y que el ajuste manual quede en el AuditLog.
 */
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

/** Reloj del servicio. Se mueve a mano para probar vencimientos sin esperar. */
let ahora = Temporal.Instant.from('2026-03-01T12:00:00Z');

interface ContractBody {
  publicId: string;
  memberId: string;
  productName: string;
  priceSnapshotCents: number;
  creditsTotal: number;
  creditsUsed: number;
  status: string;
  endsAt: string | null;
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

/** Un centro con su sede, un socio y el catálogo listo para vender. */
async function centroConSocio(nombre: string) {
  const centro = await nuevoCentro(nombre);
  const sede = await post<{ publicId: string }>(centro.cookie, '/api/v1/venues', {
    name: 'Box Toro Centro',
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const socio = await post<{ publicId: string }>(centro.cookie, '/api/v1/members', {
    firstName: 'Micaela',
    lastName: 'Sosa',
    venueIds: [sede.publicId],
  });

  return { ...centro, venueId: sede.publicId, memberId: socio.publicId };
}

async function publicarPack(
  cookie: string,
  venueId: string,
  overrides: Record<string, unknown> = {},
) {
  return post<{ publicId: string }>(cookie, '/api/v1/products', {
    name: 'Pack 8 clases',
    type: 'class_pack',
    priceCents: 6_000_000,
    credits: 8,
    durationDays: 30,
    venueIds: [venueId],
    ...overrides,
  });
}

async function vender(
  cookie: string,
  centro: { venueId: string; memberId: string },
  productId: string,
  overrides: Record<string, unknown> = {},
) {
  return post<ContractBody>(cookie, '/api/v1/contracts', {
    memberId: centro.memberId,
    productId,
    venueId: centro.venueId,
    ...overrides,
  });
}

/** Activa un contrato recién vendido, como haría el cobro. */
async function activar(cookie: string, contractId: string) {
  return post<ContractBody>(cookie, `/api/v1/contracts/${contractId}/activate`, {});
}

/** Consume un crédito como lo haría Booking (F1-14), dentro del tenant del centro. */
async function consumir(organizationId: string, memberId: string, context = {}) {
  return runWithTenant(
    { tenantId: organizationId, userId: 'usr_test', requestId: 'req-consume' },
    () => modules.contracts.service.consume(memberId, context),
  );
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_contracts_test' });

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
    memberships: { add: () => Promise.resolve() },
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
  ahora = Temporal.Instant.from('2026-03-01T12:00:00Z');
  entitlements.invalidateAll();
  for (const coleccion of ['contracts', 'products', 'members', 'venues', 'auditLogs']) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('venta', () => {
  it('crea el contrato con el precio y las condiciones congeladas', async () => {
    const centro = await centroConSocio('venta');
    const pack = await publicarPack(centro.cookie, centro.venueId);

    const contrato = await vender(centro.cookie, centro, pack.publicId);

    expect(contrato.priceSnapshotCents).toBe(6_000_000);
    expect(contrato.creditsTotal).toBe(8);
    expect(contrato.creditsUsed).toBe(0);
    // Nace esperando el cobro: el crédito no se puede usar hasta que se pague.
    expect(contrato.status).toBe('pending_payment');
  });

  it('el vencimiento se calcula en el calendario del centro, no sumando horas', async () => {
    const centro = await centroConSocio('vencimiento');
    const pack = await publicarPack(centro.cookie, centro.venueId, { durationDays: 30 });

    const contrato = await vender(centro.cookie, centro, pack.publicId);

    // 1 de marzo + 30 días de calendario = 31 de marzo, a la misma hora local.
    expect(contrato.endsAt?.slice(0, 10)).toBe('2026-03-31');
  });

  it('editar el producto después NO cambia lo ya vendido', async () => {
    const centro = await centroConSocio('snapshot');
    const pack = await publicarPack(centro.cookie, centro.venueId);
    const contrato = await vender(centro.cookie, centro, pack.publicId);

    await app.request(
      `/api/v1/products/${pack.publicId}`,
      req(centro.cookie, 'PATCH', { priceCents: 9_000_000, credits: 4 }),
    );

    const sinCambios = (await (
      await app.request(`/api/v1/contracts/${contrato.publicId}`, req(centro.cookie, 'GET'))
    ).json()) as ContractBody;

    // Es lo que hace `priceSnapshotCents`, extendido al resto de las condiciones:
    // lo vendido vale por lo que se vendió.
    expect(sinCambios.priceSnapshotCents).toBe(6_000_000);
    expect(sinCambios.creditsTotal).toBe(8);
  });

  it('un producto gratis nace activo: no hay nada que cobrar', async () => {
    const centro = await centroConSocio('gratis');
    const prueba = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Clase de prueba',
      type: 'trial',
      credits: 1,
      priceCents: 0,
      durationDays: undefined,
    });

    const contrato = await vender(centro.cookie, centro, prueba.publicId);

    // Dejarla esperando un pago de $0 sería una traba inventada en la puerta de
    // entrada del socio.
    expect(contrato.status).toBe('active');
  });

  it('acepta un precio distinto al de lista: la promo se congela igual', async () => {
    const centro = await centroConSocio('promo');
    const pack = await publicarPack(centro.cookie, centro.venueId);

    const contrato = await vender(centro.cookie, centro, pack.publicId, {
      priceCents: 4_500_000,
    });

    // Lo que se congela es lo que se cobró, no lo que decía la lista.
    expect(contrato.priceSnapshotCents).toBe(4_500_000);
  });

  it('se puede vender por adelantado: el pack arranca cuando corresponde', async () => {
    const centro = await centroConSocio('adelantado');
    const pack = await publicarPack(centro.cookie, centro.venueId, { durationDays: 30 });

    const contrato = await vender(centro.cookie, centro, pack.publicId, {
      startsAt: '2026-04-01T03:00:00Z',
    });

    // El socio paga el 28 la cuota que arranca el 1.
    expect(contrato.endsAt?.slice(0, 10)).toBe('2026-05-01');
  });

  it('un producto sin vigencia no vence', async () => {
    const centro = await centroConSocio('sin-vigencia');
    const evento = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Seminario de halterofilia',
      type: 'event',
      credits: undefined,
      durationDays: undefined,
    });

    const contrato = await vender(centro.cookie, centro, evento.publicId);

    expect(contrato.endsAt).toBeNull();
  });

  it('la membresía con tope congela su límite semanal', async () => {
    const centro = await centroConSocio('tope');
    const limitada = await publicarPack(centro.cookie, centro.venueId, {
      name: '3 por semana',
      type: 'membership_limited',
      credits: undefined,
      durationDays: 30,
      weeklyLimit: 3,
    });

    const contrato = await vender(centro.cookie, centro, limitada.publicId);
    const enBase = await mongoose.connection.db
      ?.collection('contracts')
      .findOne<{ weeklyLimit: number }>({ publicId: contrato.publicId });

    expect(enBase?.weeklyLimit).toBe(3);
  });

  it('la venta suma al `soldCount` del producto: es lo que hace aplicar el cupo', async () => {
    const centro = await centroConSocio('cupo');
    const pack = await publicarPack(centro.cookie, centro.venueId, { maxSales: 1 });

    await vender(centro.cookie, centro, pack.publicId);
    const segunda = await app.request(
      '/api/v1/contracts',
      req(centro.cookie, 'POST', {
        memberId: centro.memberId,
        productId: pack.publicId,
        venueId: centro.venueId,
      }),
    );

    expect(segunda.status).toBe(422);
    expect(((await segunda.json()) as ErrorBody).error.message).toContain('cupo');
  });

  it('la clase de prueba es una sola vez por persona (§2.1.17)', async () => {
    const centro = await centroConSocio('trial-unico');
    const prueba = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Clase de prueba',
      type: 'trial',
      credits: 1,
      priceCents: 0,
      durationDays: undefined,
    });
    await vender(centro.cookie, centro, prueba.publicId);

    const segunda = await app.request(
      '/api/v1/contracts',
      req(centro.cookie, 'POST', {
        memberId: centro.memberId,
        productId: prueba.publicId,
        venueId: centro.venueId,
      }),
    );

    // Es la regla que evita que alguien entrene gratis para siempre encadenando
    // pruebas. Cierra la deuda que F1-07 dejó declarada.
    expect(segunda.status).toBe(409);
    expect(((await segunda.json()) as ErrorBody).error.code).toBe('LP-PROD-409-002');
  });
});

describe('máquina de estados (§14)', () => {
  it('el camino del cobro: pendiente → activo', async () => {
    const centro = await centroConSocio('activar');
    const pack = await publicarPack(centro.cookie, centro.venueId);
    const contrato = await vender(centro.cookie, centro, pack.publicId);

    expect((await activar(centro.cookie, contrato.publicId)).status).toBe('active');
  });

  it('activar dos veces es una transición inválida, no un no-op', async () => {
    const centro = await centroConSocio('doble-activar');
    const pack = await publicarPack(centro.cookie, centro.venueId);
    const contrato = await vender(centro.cookie, centro, pack.publicId);
    await activar(centro.cookie, contrato.publicId);

    const res = await app.request(
      `/api/v1/contracts/${contrato.publicId}/activate`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-CTRT-422-004');
  });

  it('un contrato cancelado no revive', async () => {
    const centro = await centroConSocio('cancelado');
    const pack = await publicarPack(centro.cookie, centro.venueId);
    const contrato = await vender(centro.cookie, centro, pack.publicId);
    await post(centro.cookie, `/api/v1/contracts/${contrato.publicId}/cancel`, {});

    const res = await app.request(
      `/api/v1/contracts/${contrato.publicId}/activate`,
      req(centro.cookie, 'POST', {}),
    );

    // La renovación crea un contrato nuevo, que es lo que mantiene legible el
    // histórico de lo cobrado.
    expect(res.status).toBe(422);
  });
});

describe('consumo de crédito (ADR-001: se descuenta al reservar)', () => {
  /** Un socio con un pack activo de N créditos. */
  async function conPack(nombre: string, credits = 8, extra: Record<string, unknown> = {}) {
    const centro = await centroConSocio(nombre);
    const pack = await publicarPack(centro.cookie, centro.venueId, { credits, ...extra });
    const contrato = await vender(centro.cookie, centro, pack.publicId);
    await activar(centro.cookie, contrato.publicId);

    return { ...centro, contractId: contrato.publicId };
  }

  it('descuenta uno y dice de qué pack salió', async () => {
    const centro = await conPack('consumo');

    const consumo = await consumir(centro.organizationId, centro.memberId);

    expect(consumo.contractId).toBe(centro.contractId);
    expect(consumo.creditsLeft).toBe(7);
    // §2.1.9: el resultado tiene que ser explicable al socio.
    expect(consumo.reason).toContain('vence primero');
  });

  it('un contrato sin pagar no se puede usar', async () => {
    const centro = await centroConSocio('sin-pagar');
    const pack = await publicarPack(centro.cookie, centro.venueId);
    await vender(centro.cookie, centro, pack.publicId);

    await expect(consumir(centro.organizationId, centro.memberId)).rejects.toThrow();
  });

  it('sin créditos responde LP-CTRT-402-001', async () => {
    const centro = await conPack('agotado', 1);
    await consumir(centro.organizationId, centro.memberId);

    await expect(consumir(centro.organizationId, centro.memberId)).rejects.toMatchObject({
      code: 'LP-CTRT-402-001',
    });
  });

  it('vencido no se consume', async () => {
    const centro = await conPack('vencido', 8, { durationDays: 1 });

    ahora = Temporal.Instant.from('2026-03-05T12:00:00Z');

    await expect(consumir(centro.organizationId, centro.memberId)).rejects.toMatchObject({
      code: 'LP-CTRT-402-001',
    });
  });

  it('una membresía no descuenta créditos pero sí valida vigencia', async () => {
    const centro = await centroConSocio('membresia');
    const libre = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Libre mensual',
      type: 'membership_unlimited',
      credits: undefined,
      priceCents: 8_500_000,
      durationDays: 30,
    });
    const contrato = await vender(centro.cookie, centro, libre.publicId);
    await activar(centro.cookie, contrato.publicId);

    const consumo = await consumir(centro.organizationId, centro.memberId);

    expect(consumo.creditsLeft).toBeNull();
    expect(consumo.contractId).toBe(contrato.publicId);
  });

  it('elige el que vence primero, y lo dice', async () => {
    const centro = await centroConSocio('fifo');
    const corto = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Pack corto',
      durationDays: 10,
    });
    const largo = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Pack largo',
      durationDays: 60,
    });

    for (const producto of [largo, corto]) {
      const contrato = await vender(centro.cookie, centro, producto.publicId);
      await activar(centro.cookie, contrato.publicId);
    }

    const consumo = await consumir(centro.organizationId, centro.memberId);

    // El ejemplo de la spec: se descuenta del que vence primero, porque es el
    // que se pierde si no se usa.
    expect(consumo.productName).toBe('Pack corto');
  });

  it('cuando el que vence primero se agota, sigue con el siguiente', async () => {
    const centro = await centroConSocio('fifo-agotado');
    const corto = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Pack corto',
      durationDays: 10,
      credits: 1,
    });
    const largo = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Pack largo',
      durationDays: 60,
      credits: 5,
    });

    for (const producto of [corto, largo]) {
      const contrato = await vender(centro.cookie, centro, producto.publicId);
      await activar(centro.cookie, contrato.publicId);
    }

    expect((await consumir(centro.organizationId, centro.memberId)).productName).toBe('Pack corto');
    expect((await consumir(centro.organizationId, centro.memberId)).productName).toBe('Pack largo');
  });

  it('una categoría no habilitada no consume ese contrato', async () => {
    const centro = await centroConSocio('categoria');
    const pilates = await publicarPack(centro.cookie, centro.venueId, {
      name: 'Pack pilates',
      allowedCategories: ['pilates'],
    });
    const contrato = await vender(centro.cookie, centro, pilates.publicId);
    await activar(centro.cookie, contrato.publicId);

    await expect(
      consumir(centro.organizationId, centro.memberId, { category: 'funcional' }),
    ).rejects.toThrow();

    const consumo = await consumir(centro.organizationId, centro.memberId, { category: 'pilates' });
    expect(consumo.contractId).toBe(contrato.publicId);
  });

  it('la devolución repone el crédito (cancelación en plazo)', async () => {
    const centro = await conPack('devolucion', 8);
    await consumir(centro.organizationId, centro.memberId);

    const devuelto = await runWithTenant(
      { tenantId: centro.organizationId, userId: 'usr_test', requestId: 'req-refund' },
      () => modules.contracts.service.refund(centro.contractId),
    );

    expect(devuelto.creditsUsed).toBe(0);
  });

  it('devolver dos veces no deja créditos negativos', async () => {
    const centro = await conPack('devolucion-doble', 8);
    await consumir(centro.organizationId, centro.memberId);

    const refund = () =>
      runWithTenant(
        { tenantId: centro.organizationId, userId: 'usr_test', requestId: 'req-refund' },
        () => modules.contracts.service.refund(centro.contractId),
      );

    await refund();
    await expect(refund()).rejects.toThrow();
  });
});

describe('🔴 consumo concurrente sobre el último crédito', () => {
  it('cinco reservas simultáneas sobre 1 crédito: gana exactamente una', async () => {
    const centro = await centroConSocio('concurrencia');
    const pack = await publicarPack(centro.cookie, centro.venueId, { credits: 1 });
    const contrato = await vender(centro.cookie, centro, pack.publicId);
    await activar(centro.cookie, contrato.publicId);

    const resultados = await Promise.allSettled(
      Array.from({ length: 5 }, () => consumir(centro.organizationId, centro.memberId)),
    );

    /*
     * El descuento es un `findOneAndUpdate` con `$expr` sobre
     * `creditsUsed < creditsTotal`: el filtro y el `$inc` suceden en la misma
     * operación. Con un read y después un write, los cinco leerían
     * `creditsUsed: 0` y el socio terminaría con 5 clases usadas de un pack de 1.
     */
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const enBase = await mongoose.connection.db
      ?.collection('contracts')
      .findOne<{ creditsUsed: number }>({ publicId: contrato.publicId });
    expect(enBase?.creditsUsed).toBe(1);
  });

  it('con dos packs de 1 crédito, dos reservas simultáneas ganan las dos', async () => {
    const centro = await centroConSocio('concurrencia-dos');
    for (const durationDays of [10, 60]) {
      const producto = await publicarPack(centro.cookie, centro.venueId, {
        name: `Pack ${durationDays}`,
        credits: 1,
        durationDays,
      });
      const contrato = await vender(centro.cookie, centro, producto.publicId);
      await activar(centro.cookie, contrato.publicId);
    }

    const resultados = await Promise.allSettled(
      Array.from({ length: 2 }, () => consumir(centro.organizationId, centro.memberId)),
    );

    // Descartar una reserva porque justo se agotó el pack que el sistema eligió,
    // teniendo otro disponible, sería un error nuestro: por eso se reintenta con
    // el candidato siguiente.
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  });
});

describe('ajuste manual de créditos', () => {
  async function conPackActivo(nombre: string) {
    const centro = await centroConSocio(nombre);
    const pack = await publicarPack(centro.cookie, centro.venueId);
    const contrato = await vender(centro.cookie, centro, pack.publicId);
    await activar(centro.cookie, contrato.publicId);

    return { ...centro, contractId: contrato.publicId };
  }

  it('suma créditos y deja el motivo en el AuditLog', async () => {
    const centro = await conPackActivo('ajuste');

    const res = await app.request(
      `/api/v1/contracts/${centro.contractId}/credits`,
      req(centro.cookie, 'POST', { delta: 2, reason: 'Compensación por clase cancelada.' }),
    );

    expect(((await res.json()) as ContractBody).creditsTotal).toBe(10);

    const auditoria = await mongoose.connection.db
      ?.collection('auditLogs')
      .findOne<{ reason: string; before: unknown; after: unknown }>({
        targetId: centro.contractId,
      });

    // Seis meses después alguien pregunta por qué su pack tenía 10 clases.
    expect(auditoria?.reason).toBe('Compensación por clase cancelada.');
    expect(auditoria?.before).toEqual({ creditsTotal: 8 });
    expect(auditoria?.after).toEqual({ creditsTotal: 10 });
  });

  it('sin motivo no se puede ajustar', async () => {
    const centro = await conPackActivo('ajuste-sin-motivo');

    const res = await app.request(
      `/api/v1/contracts/${centro.contractId}/credits`,
      req(centro.cookie, 'POST', { delta: 2 }),
    );

    // Un ajuste sin motivo es indistinguible de un error.
    expect(res.status).toBe(422);
  });

  it('no se puede bajar por debajo de lo ya usado', async () => {
    const centro = await conPackActivo('ajuste-bajo');
    for (let i = 0; i < 3; i += 1) await consumir(centro.organizationId, centro.memberId);

    const res = await app.request(
      `/api/v1/contracts/${centro.contractId}/credits`,
      req(centro.cookie, 'POST', { delta: -6, reason: 'Error de carga en la venta.' }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.message).toContain('3');
  });
});

describe('contratos inexistentes', () => {
  it('ver, ajustar y devolver responden LP-CTRT-404-005', async () => {
    const centro = await centroConSocio('inexistente');

    const ver = await app.request('/api/v1/contracts/ctr_no_existe', req(centro.cookie, 'GET'));
    const ajustar = await app.request(
      '/api/v1/contracts/ctr_no_existe/credits',
      req(centro.cookie, 'POST', { delta: 1, reason: 'Prueba de contrato inexistente.' }),
    );

    expect(ver.status).toBe(404);
    expect(((await ver.json()) as ErrorBody).error.code).toBe('LP-CTRT-404-005');
    expect(ajustar.status).toBe(404);

    await expect(
      runWithTenant(
        { tenantId: centro.organizationId, userId: 'usr_test', requestId: 'req-refund' },
        () => modules.contracts.service.refund('ctr_no_existe'),
      ),
    ).rejects.toMatchObject({ code: 'LP-CTRT-404-005' });
  });

  it('el listado filtra por socio y por estado', async () => {
    const centro = await centroConSocio('filtros');
    const pack = await publicarPack(centro.cookie, centro.venueId);
    const contrato = await vender(centro.cookie, centro, pack.publicId);
    await activar(centro.cookie, contrato.publicId);

    const activos = await (
      await app.request('/api/v1/contracts?status=active', req(centro.cookie, 'GET'))
    ).json();
    const delSocio = await (
      await app.request(`/api/v1/contracts?memberId=${centro.memberId}`, req(centro.cookie, 'GET'))
    ).json();
    const pendientes = await (
      await app.request('/api/v1/contracts?status=pending_payment', req(centro.cookie, 'GET'))
    ).json();

    expect((activos as { items: unknown[] }).items).toHaveLength(1);
    expect((delSocio as { items: unknown[] }).items).toHaveLength(1);
    expect((pendientes as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve ni toca los contratos del otro centro', async () => {
    const victima = await centroConSocio('ctr-victima');
    const pack = await publicarPack(victima.cookie, victima.venueId, { name: 'Pack Confidencial' });
    const contrato = await vender(victima.cookie, victima, pack.publicId);
    const atacante = await nuevoCentro('ctr-atacante');

    const ver = await app.request(
      `/api/v1/contracts/${contrato.publicId}`,
      req(atacante.cookie, 'GET'),
    );
    const activarAjeno = await app.request(
      `/api/v1/contracts/${contrato.publicId}/activate`,
      req(atacante.cookie, 'POST', {}),
    );
    const listado = await (
      await app.request('/api/v1/contracts', req(atacante.cookie, 'GET'))
    ).text();

    expect(ver.status).toBe(404);
    expect(activarAjeno.status).toBe(404);
    expect((JSON.parse(listado) as { items: unknown[] }).items).toEqual([]);
    expect(listado).not.toContain('Confidencial');
  });

  it('no se puede vender un producto de otro centro', async () => {
    const victima = await centroConSocio('ctr-prod-victima');
    const pack = await publicarPack(victima.cookie, victima.venueId);
    const atacante = await centroConSocio('ctr-prod-atacante');

    const res = await app.request(
      '/api/v1/contracts',
      req(atacante.cookie, 'POST', {
        memberId: atacante.memberId,
        productId: pack.publicId,
        venueId: atacante.venueId,
      }),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-PROD-404-003');
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las seis rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter((route) =>
      route.path.startsWith('/api/v1/contracts'),
    );

    expect(rutas).toHaveLength(6);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('ctr-fixtures');
    const victima = await nuevoCentro('ctr-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      if (!route.path.startsWith('/api/v1/contracts') || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: { 'content-type': 'application/json', cookie: atacante.cookie },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        VICTIM_CONTRACT_PRODUCT,
      );
    }
  });

  it('cada ruta montada está declarada', () => {
    const montadas = app.routes
      .filter((route) => route.path.startsWith('/api/v1/contracts'))
      .filter((route) => route.method !== 'ALL')
      .map((route) => `${route.method} ${route.path}`);

    const declaradas = allRegisteredRoutes()
      .filter((route) => route.path.startsWith('/api/v1/contracts'))
      .map((route) => `${route.method} ${route.path}`);

    for (const montada of montadas) {
      expect(declaradas, montada).toContain(montada);
    }
  });
});
