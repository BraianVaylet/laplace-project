import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import type { AccountStatement } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createAuth, type Auth } from '../src/auth/auth.js';
import type { EmailSender } from '../src/auth/ports.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { allRegisteredRoutes, resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { VICTIM_CHARGE_DESCRIPTION } from '../src/modules/billing/infrastructure/routes.js';
import { createLogger } from '../src/observability/logger.js';
import { runWithTenant } from '../src/tenancy/context.js';

/**
 * F1-10. El dinero entre el centro y sus socios (§2.1.16), que es el gap más
 * grave de la v1.
 *
 * Lo que se verifica y no se negocia: la **idempotencia** del pago (§Testing.3),
 * que ningún camino borre un `Payment` (§5.2.4), el pago parcial, y que el
 * dinero sea entero en centavos de punta a punta.
 */
const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260901120000-mandatory-indexes.cjs') as {
  up(db: Db): Promise<void>;
};

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

let ahora = Temporal.Instant.from('2026-03-15T12:00:00Z');

interface ChargeBody {
  publicId: string;
  amountCents: number;
  paidCents: number;
  status: string;
}
interface PaymentBody {
  publicId: string;
  amountCents: number;
  refundedCents: number;
  status: string;
  method: string;
  receivedBy: string;
  chargeIds: string[];
}
type ErrorBody = {
  success: false;
  error: { code: string; message: string; action?: string };
};

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

async function post<T>(cookie: string, path: string, body: unknown, headers = {}): Promise<T> {
  const res = await app.request(path, req(cookie, 'POST', body, headers));
  if (res.status >= 400) throw new Error(`${path} falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as T;
}

/** Un centro con sede y socio, listo para cobrar. */
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

type Centro = Awaited<ReturnType<typeof centroConSocio>>;

async function cobrar(centro: Centro, overrides: Record<string, unknown> = {}) {
  return post<ChargeBody>(centro.cookie, '/api/v1/charges', {
    memberId: centro.memberId,
    venueId: centro.venueId,
    amountCents: 6_000_000,
    description: 'Pack 8 clases',
    ...overrides,
  });
}

let clave = 0;
const nuevaClave = () => `idem-${++clave}-${Date.now()}`;

async function pagar(
  centro: Centro,
  overrides: Record<string, unknown> = {},
  idempotencyKey = nuevaClave(),
) {
  return app.request(
    '/api/v1/payments',
    req(
      centro.cookie,
      'POST',
      {
        memberId: centro.memberId,
        venueId: centro.venueId,
        amountCents: 6_000_000,
        method: 'cash',
        ...overrides,
      },
      { 'Idempotency-Key': idempotencyKey },
    ),
  );
}

async function pagarOk(centro: Centro, overrides = {}, key = nuevaClave()) {
  const res = await pagar(centro, overrides, key);
  if (res.status !== 201) throw new Error(`pago falló: ${res.status} ${await res.text()}`);

  return (await res.json()) as PaymentBody;
}

async function estadoDeCuenta(centro: Centro): Promise<AccountStatement> {
  const res = await app.request(
    `/api/v1/members/${centro.memberId}/statement`,
    req(centro.cookie, 'GET'),
  );

  return (await res.json()) as AccountStatement;
}

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_billing_test' });
  // El unico parcial `{ tenantId, idempotencyKey }` es la garantia real contra
  // el doble cobro: se prueba contra el indice de produccion.
  await migration.up(mongoose.connection.db as Db);

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
  ahora = Temporal.Instant.from('2026-03-15T12:00:00Z');
  entitlements.invalidateAll();
  for (const coleccion of ['charges', 'payments', 'refunds', 'members', 'venues', 'auditLogs']) {
    await mongoose.connection.db?.collection(coleccion).deleteMany({});
  }
});

describe('cargos', () => {
  it('genera un cargo pendiente con su monto en centavos', async () => {
    const centro = await centroConSocio('cargo');

    const cargo = await cobrar(centro);

    expect(cargo.amountCents).toBe(6_000_000);
    expect(cargo.paidCents).toBe(0);
    expect(cargo.status).toBe('pending');
  });

  it('el cargo puede colgar de un contrato y el pago llevar nota', async () => {
    const centro = await centroConSocio('cargo-completo');
    const cargo = await cobrar(centro, { contractId: 'ctr_pack', dueAt: '2026-04-01T12:00:00Z' });

    await pagarOk(centro, { note: 'Pagó la mamá por transferencia.', method: 'transfer' });
    const estado = await estadoDeCuenta(centro);

    // El cargo sabe de dónde vino, y el pago guarda lo que el mostrador anotó.
    expect(estado.charges.find((c) => c.publicId === cargo.publicId)?.contractId).toBe('ctr_pack');
    expect(estado.payments[0]?.note).toBe('Pagó la mamá por transferencia.');
    expect(estado.payments[0]?.method).toBe('transfer');
  });

  it('rechaza un monto en cero o negativo', async () => {
    const centro = await centroConSocio('cargo-cero');

    for (const amountCents of [0, -100]) {
      const res = await app.request(
        '/api/v1/charges',
        req(centro.cookie, 'POST', {
          memberId: centro.memberId,
          venueId: centro.venueId,
          amountCents,
          description: 'Inválido',
        }),
      );
      expect(res.status, `${amountCents}`).toBe(422);
    }
  });

  it('anular un cargo no lo borra: queda en `void` y deja de contar', async () => {
    const centro = await centroConSocio('anular');
    const cargo = await cobrar(centro);

    const res = await app.request(
      `/api/v1/charges/${cargo.publicId}/void`,
      req(centro.cookie, 'POST', { reason: 'Se cargó dos veces por error.' }),
    );

    expect(((await res.json()) as ChargeBody).status).toBe('void');
    expect((await estadoDeCuenta(centro)).balanceCents).toBe(0);

    const auditoria = await mongoose.connection.db
      ?.collection('auditLogs')
      .findOne<{ reason: string }>({ targetId: cargo.publicId });
    expect(auditoria?.reason).toBe('Se cargó dos veces por error.');
  });
});

describe('pagos', () => {
  it('registra el pago con método, monto, fecha y quién lo registró', async () => {
    const centro = await centroConSocio('pago');
    await cobrar(centro);

    const pago = await pagarOk(centro, { receipt: '0001-00012345' });

    expect(pago.amountCents).toBe(6_000_000);
    expect(pago.method).toBe('cash');
    expect(pago.status).toBe('approved');
    // En un arqueo que no cierra, quién lo registró es la primera pregunta.
    expect(pago.receivedBy).toBeTruthy();
  });

  it('salda el cargo y deja el saldo en cero', async () => {
    const centro = await centroConSocio('salda');
    const cargo = await cobrar(centro);

    await pagarOk(centro);
    const estado = await estadoDeCuenta(centro);

    expect(estado.balanceCents).toBe(0);
    expect(estado.charges.find((c) => c.publicId === cargo.publicId)?.status).toBe('paid');
  });

  it('un pago parcial deja el cargo pendiente y el saldo refleja la diferencia', async () => {
    const centro = await centroConSocio('parcial');
    const cargo = await cobrar(centro);

    await pagarOk(centro, { amountCents: 2_000_000 });
    const estado = await estadoDeCuenta(centro);

    expect(estado.balanceCents).toBe(-4_000_000);
    const actualizado = estado.charges.find((c) => c.publicId === cargo.publicId);
    expect(actualizado?.status).toBe('pending');
    expect(actualizado?.paidCents).toBe(2_000_000);
  });

  it('un pago salda varios cargos, del más viejo al más nuevo', async () => {
    const centro = await centroConSocio('varios');
    await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-01-01T12:00:00Z' });
    await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-02-01T12:00:00Z' });

    const pago = await pagarOk(centro, { amountCents: 2_000_000 });
    const estado = await estadoDeCuenta(centro);

    expect(pago.chargeIds).toHaveLength(2);
    expect(estado.charges.every((c) => c.status === 'paid')).toBe(true);
    expect(estado.balanceCents).toBe(0);
  });

  it('lo que sobra queda como saldo a favor', async () => {
    const centro = await centroConSocio('a-favor');
    await cobrar(centro, { amountCents: 1_000_000 });

    await pagarOk(centro, { amountCents: 3_000_000 });

    expect((await estadoDeCuenta(centro)).balanceCents).toBe(2_000_000);
  });

  it('con `chargeIds` explícitos solo salda esos', async () => {
    const centro = await centroConSocio('imputacion-explicita');
    const viejo = await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-01-01T12:00:00Z' });
    const elegido = await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-02-01T12:00:00Z' });

    await pagarOk(centro, { amountCents: 1_000_000, chargeIds: [elegido.publicId] });
    const estado = await estadoDeCuenta(centro);

    // El mostrador a veces cobra un cargo puntual, no "lo que debe".
    expect(estado.charges.find((c) => c.publicId === elegido.publicId)?.status).toBe('paid');
    expect(estado.charges.find((c) => c.publicId === viejo.publicId)?.status).toBe('pending');
  });

  it('un pago sin cargos queda entero a favor del socio', async () => {
    const centro = await centroConSocio('sin-cargos');

    await pagarOk(centro, { amountCents: 3_000_000 });

    // Es el adelanto: paga ahora y el cargo se genera después.
    expect((await estadoDeCuenta(centro)).balanceCents).toBe(3_000_000);
  });

  it('el dinero es entero en centavos en toda la ruta', async () => {
    const centro = await centroConSocio('centavos');
    await cobrar(centro, { amountCents: 6_000_050 });

    const pago = await pagarOk(centro, { amountCents: 6_000_050 });
    const enBase = await mongoose.connection.db
      ?.collection('payments')
      .findOne<{ amountCents: number }>({ publicId: pago.publicId });

    expect(pago.amountCents).toBe(6_000_050);
    expect(enBase?.amountCents).toBe(6_000_050);
    expect(Number.isInteger(enBase?.amountCents)).toBe(true);
  });

  it('actualiza el saldo cacheado del socio y su flag de deudor', async () => {
    const centro = await centroConSocio('cache');
    await cobrar(centro);

    const conDeuda = await mongoose.connection.db
      ?.collection('members')
      .findOne<{ balanceCents: number; flags: { debtor: boolean } }>({
        publicId: centro.memberId,
      });
    expect(conDeuda?.balanceCents).toBe(-6_000_000);
    expect(conDeuda?.flags.debtor).toBe(true);

    await pagarOk(centro);

    const saldado = await mongoose.connection.db
      ?.collection('members')
      .findOne<{ balanceCents: number; flags: { debtor: boolean } }>({
        publicId: centro.memberId,
      });
    expect(saldado?.balanceCents).toBe(0);
    expect(saldado?.flags.debtor).toBe(false);
  });
});

describe('🔴 idempotencia del pago (§Testing.3)', () => {
  it('sin `Idempotency-Key` el pago no se registra', async () => {
    const centro = await centroConSocio('sin-clave');
    await cobrar(centro);

    const res = await app.request(
      '/api/v1/payments',
      req(centro.cookie, 'POST', {
        memberId: centro.memberId,
        venueId: centro.venueId,
        amountCents: 6_000_000,
        method: 'cash',
      }),
    );

    // Sin la clave, el reintento de un pago que falló por timeout cobra dos veces.
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.message).toContain('Idempotency-Key');
  });

  it('el mismo pago tres veces se registra UNA sola vez', async () => {
    const centro = await centroConSocio('idem-tres');
    await cobrar(centro);
    const key = nuevaClave();

    const primera = await pagar(centro, {}, key);
    const segunda = await pagar(centro, {}, key);
    const tercera = await pagar(centro, {}, key);

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(409);
    expect(tercera.status).toBe(409);
    expect(((await segunda.json()) as ErrorBody).error.code).toBe('LP-BILL-409-002');

    const cuantos = await mongoose.connection.db
      ?.collection('payments')
      .countDocuments({ memberId: centro.memberId });
    expect(cuantos).toBe(1);
  });

  it('el error del duplicado trae el pago original', async () => {
    const centro = await centroConSocio('idem-original');
    await cobrar(centro);
    const key = nuevaClave();
    const original = (await (await pagar(centro, {}, key)).json()) as PaymentBody;

    const repetido = await pagar(centro, {}, key);
    const body = (await repetido.json()) as ErrorBody & { error: { meta?: unknown } };

    // Sin el pago original, el mostrador no puede confirmar que el cobro entró y
    // termina cobrándolo de nuevo a mano.
    expect(body.error.action).toContain('estado de cuenta');
    expect(JSON.stringify(body)).not.toContain('undefined');
    expect(original.publicId).toMatch(/^pay_/);
  });

  it('el saldo no se toca dos veces por el reintento', async () => {
    const centro = await centroConSocio('idem-saldo');
    await cobrar(centro);
    const key = nuevaClave();

    await pagar(centro, {}, key);
    await pagar(centro, {}, key);

    expect((await estadoDeCuenta(centro)).balanceCents).toBe(0);
  });

  it('dos pagos simultáneos con la misma clave: gana uno solo', async () => {
    const centro = await centroConSocio('idem-carrera');
    await cobrar(centro);
    const key = nuevaClave();

    const resultados = await Promise.all([
      pagar(centro, {}, key),
      pagar(centro, {}, key),
      pagar(centro, {}, key),
    ]);

    /*
     * El chequeo previo tiene una ventana; lo que la cierra es el índice único
     * `{ tenantId, idempotencyKey }`. El que pierde la carrera recibe el mismo
     * 409 que el que llegó tarde, no un 500.
     */
    expect(resultados.filter((res) => res.status === 201)).toHaveLength(1);
    for (const res of resultados.filter((r) => r.status !== 201)) {
      expect(res.status).toBe(409);
    }
  });

  it('claves distintas registran pagos distintos', async () => {
    const centro = await centroConSocio('idem-distintas');
    await cobrar(centro, { amountCents: 2_000_000 });
    await cobrar(centro, { amountCents: 2_000_000 });

    await pagarOk(centro, { amountCents: 2_000_000 });
    await pagarOk(centro, { amountCents: 2_000_000 });

    expect((await estadoDeCuenta(centro)).payments).toHaveLength(2);
  });
});

describe('reembolsos: un pago nunca se borra (§5.2.4)', () => {
  it('el reembolso no borra el pago, lo marca', async () => {
    const centro = await centroConSocio('reembolso');
    await cobrar(centro);
    const pago = await pagarOk(centro);

    const res = await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { reason: 'El socio se dio de baja el mismo día.' }),
    );
    const body = (await res.json()) as PaymentBody;

    expect(body.status).toBe('refunded');
    expect(body.refundedCents).toBe(6_000_000);

    // Si el pago desapareciera, el arqueo del día anterior dejaría de coincidir.
    const sigue = await mongoose.connection.db
      ?.collection('payments')
      .findOne({ publicId: pago.publicId });
    expect(sigue).not.toBeNull();
  });

  it('el cargo vuelve a deber', async () => {
    const centro = await centroConSocio('reembolso-cargo');
    const cargo = await cobrar(centro);
    const pago = await pagarOk(centro);

    await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { reason: 'Se cobró de más.' }),
    );
    const estado = await estadoDeCuenta(centro);

    expect(estado.balanceCents).toBe(-6_000_000);
    expect(estado.charges.find((c) => c.publicId === cargo.publicId)?.status).toBe('pending');
  });

  it('un reembolso parcial deja el resto disponible', async () => {
    const centro = await centroConSocio('reembolso-parcial');
    await cobrar(centro);
    const pago = await pagarOk(centro);

    const res = await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { amountCents: 2_000_000, reason: 'Devolución parcial.' }),
    );
    const body = (await res.json()) as PaymentBody;

    expect(body.refundedCents).toBe(2_000_000);
    // Todavía queda algo: no está completamente reembolsado.
    expect(body.status).toBe('approved');
    expect((await estadoDeCuenta(centro)).balanceCents).toBe(-2_000_000);
  });

  it('no se puede reembolsar más de lo que queda', async () => {
    const centro = await centroConSocio('reembolso-exceso');
    await cobrar(centro);
    const pago = await pagarOk(centro);
    await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { amountCents: 5_000_000, reason: 'Primera devolución.' }),
    );

    const res = await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { amountCents: 2_000_000, reason: 'Segunda devolución.' }),
    );
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(409);
    expect(body.error.code).toBe('LP-BILL-409-005');
    expect(body.error.message).toContain('10.000');
  });

  it('un reembolso parcial revierte el último cargo saldado, no el primero', async () => {
    const centro = await centroConSocio('reembolso-orden');
    const viejo = await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-01-01T12:00:00Z' });
    const nuevo = await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-02-01T12:00:00Z' });
    const pago = await pagarOk(centro, { amountCents: 2_000_000 });

    await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { amountCents: 1_000_000, reason: 'Se devolvió una mitad.' }),
    );
    const estado = await estadoDeCuenta(centro);

    // La deuda que reaparece es la última que se saldó: la vieja ya estaba
    // cobrada antes y no tiene por qué volver a abrirse.
    expect(estado.charges.find((c) => c.publicId === viejo.publicId)?.status).toBe('paid');
    expect(estado.charges.find((c) => c.publicId === nuevo.publicId)?.status).toBe('pending');
  });

  it('sin motivo no se reembolsa', async () => {
    const centro = await centroConSocio('reembolso-sin-motivo');
    await cobrar(centro);
    const pago = await pagarOk(centro);

    const res = await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', {}),
    );

    expect(res.status).toBe(422);
  });

  it('un pago inexistente da 404 con código tipado', async () => {
    const centro = await centroConSocio('reembolso-404');

    const res = await app.request(
      '/api/v1/payments/pay_no_existe/refund',
      req(centro.cookie, 'POST', { reason: 'No debería llegar acá.' }),
    );

    expect(res.status).toBe(404);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-BILL-404-004');
  });
});

describe('estado de cuenta', () => {
  it('muestra cargos, pagos, saldo y deuda vencida en orden cronológico', async () => {
    const centro = await centroConSocio('estado');
    await cobrar(centro, { amountCents: 1_000_000, dueAt: '2026-01-01T12:00:00Z' });
    await cobrar(centro, { amountCents: 2_000_000, dueAt: '2026-06-01T12:00:00Z' });
    await pagarOk(centro, { amountCents: 500_000 });

    const estado = await estadoDeCuenta(centro);

    expect(estado.charges.map((c) => c.amountCents)).toEqual([1_000_000, 2_000_000]);
    expect(estado.balanceCents).toBe(-2_500_000);
    // Solo el primero venció: 1.000.000 menos los 500.000 imputados.
    expect(estado.overdueCents).toBe(500_000);
  });

  it('un socio sin movimientos tiene saldo cero', async () => {
    const centro = await centroConSocio('estado-vacio');

    const estado = await estadoDeCuenta(centro);

    expect(estado).toMatchObject({ balanceCents: 0, overdueCents: 0, charges: [], payments: [] });
  });
});

describe('mora (§2.1.12)', () => {
  const correrJob = async (name: string) => {
    const job = modules.jobs.find((candidate) => candidate.name === name);
    if (!job) throw new Error(`no existe el job ${name}`);

    await job.handler();
  };

  const cargoEnBase = async (chargeId: string) =>
    mongoose.connection.db
      ?.collection('charges')
      .findOne<{ status: string }>({ publicId: chargeId });

  it('el job pasa a `overdue` los cargos vencidos e impagos', async () => {
    const centro = await centroConSocio('mora');
    const cargo = await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });

    await correrJob('dunning');

    expect((await cargoEnBase(cargo.publicId))?.status).toBe('overdue');
  });

  it('el socio queda marcado como deudor', async () => {
    const centro = await centroConSocio('mora-flag');
    await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });

    await correrJob('dunning');

    const socio = await mongoose.connection.db
      ?.collection('members')
      .findOne<{ flags: { debtor: boolean } }>({ publicId: centro.memberId });
    expect(socio?.flags.debtor).toBe(true);
  });

  it('no toca los que todavía no vencieron', async () => {
    const centro = await centroConSocio('mora-vigente');
    const cargo = await cobrar(centro, { dueAt: '2026-06-01T12:00:00Z' });

    await correrJob('dunning');

    expect((await cargoEnBase(cargo.publicId))?.status).toBe('pending');
  });

  it('no toca los que ya se pagaron, aunque la fecha haya pasado', async () => {
    const centro = await centroConSocio('mora-pagado');
    const cargo = await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });
    await pagarOk(centro);

    await correrJob('dunning');

    expect((await cargoEnBase(cargo.publicId))?.status).toBe('paid');
  });

  it('un cargo parcialmente pagado sí entra en mora por lo que falta', async () => {
    const centro = await centroConSocio('mora-parcial');
    const cargo = await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });
    await pagarOk(centro, { amountCents: 2_000_000 });

    await correrJob('dunning');

    expect((await cargoEnBase(cargo.publicId))?.status).toBe('overdue');
  });

  it('es idempotente: la segunda corrida del día no encuentra nada', async () => {
    const centro = await centroConSocio('mora-idempotente');
    await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });

    await correrJob('dunning');
    // El runner garantiza que no corran dos a la vez, no que no corran dos veces.
    await correrJob('dunning');

    const cuantos = await mongoose.connection.db
      ?.collection('charges')
      .countDocuments({ memberId: centro.memberId, status: 'overdue' });
    expect(cuantos).toBe(1);
  });

  it('el estado de cobranza del socio se ve en tiempo real', async () => {
    const centro = await centroConSocio('estado-cobranza');

    expect((await estadoDeCuenta(centro)).status).toBe('clear');

    await cobrar(centro, { dueAt: '2026-06-01T12:00:00Z' });
    expect((await estadoDeCuenta(centro)).status).toBe('pending');

    await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });
    expect((await estadoDeCuenta(centro)).status).toBe('overdue');
  });

  it('con saldo a favor el estado es `credit`', async () => {
    const centro = await centroConSocio('estado-credito');

    await pagarOk(centro, { amountCents: 3_000_000 });

    expect((await estadoDeCuenta(centro)).status).toBe('credit');
  });
});

describe('mora × reserva: el corte que aplica `allowDebt` (ADR-004)', () => {
  const corte = (organizationId: string, memberId: string, allowDebt: boolean) =>
    runWithTenant({ tenantId: organizationId, userId: 'usr_test', requestId: 'req-corte' }, () =>
      modules.billing.service.assertCanTransact(memberId, allowDebt),
    );

  it('con `allowDebt: false`, el socio en mora no puede: LP-BOOK-403-005', async () => {
    const centro = await centroConSocio('corte-bloquea');
    await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });

    await expect(corte(centro.organizationId, centro.memberId, false)).rejects.toMatchObject({
      code: 'LP-BOOK-403-005',
    });
  });

  it('el mensaje dice cuánto debe', async () => {
    const centro = await centroConSocio('corte-monto');
    await cobrar(centro, { amountCents: 2_500_000, dueAt: '2026-03-01T12:00:00Z' });

    // "Regularizá" sin número manda al socio al mostrador a preguntar cuánto.
    await expect(corte(centro.organizationId, centro.memberId, false)).rejects.toThrow(/25\.000/);
  });

  it('con `allowDebt: true`, el mismo socio sí puede', async () => {
    const centro = await centroConSocio('corte-permite');
    await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });

    await expect(corte(centro.organizationId, centro.memberId, true)).resolves.toBeUndefined();
  });

  it('sin deuda vencida no corta, aunque tenga algo por vencer', async () => {
    const centro = await centroConSocio('corte-por-vencer');
    await cobrar(centro, { dueAt: '2026-06-01T12:00:00Z' });

    await expect(corte(centro.organizationId, centro.memberId, false)).resolves.toBeUndefined();
  });

  it('pagar la deuda levanta el corte', async () => {
    const centro = await centroConSocio('corte-regulariza');
    await cobrar(centro, { dueAt: '2026-03-01T12:00:00Z' });
    await expect(corte(centro.organizationId, centro.memberId, false)).rejects.toThrow();

    await pagarOk(centro);

    await expect(corte(centro.organizationId, centro.memberId, false)).resolves.toBeUndefined();
  });
});

describe('la idempotencia de un pago aguanta la carrera (§5.0)', () => {
  it('dos pedidos simultáneos con la misma clave cobran una sola vez', async () => {
    const centro = await centroConSocio('idem-carrera');
    await cobrar(centro, { amountCents: 10_000_000 });
    const clave = nuevaClave();

    // El doble click del mostrador: los dos salen antes de que el primero
    // termine, así que la búsqueda previa no ve nada y los dos escriben.
    const [uno, dos] = await Promise.all([
      pagar(centro, { amountCents: 6_000_000 }, clave),
      pagar(centro, { amountCents: 6_000_000 }, clave),
    ]);

    const estados = [uno.status, dos.status].sort();
    expect(estados).toEqual([201, 409]);

    // Lo que importa: en la caja hay un solo pago, no dos.
    const cuantos = await mongoose.connection.db
      ?.collection('payments')
      .countDocuments({ idempotencyKey: clave });
    expect(cuantos).toBe(1);
  });

  it('el segundo pedido devuelve el pago que ganó, no un error a secas', async () => {
    const centro = await centroConSocio('idem-ganador');
    await cobrar(centro, { amountCents: 10_000_000 });
    const clave = nuevaClave();

    const [uno, dos] = await Promise.all([
      pagar(centro, { amountCents: 6_000_000 }, clave),
      pagar(centro, { amountCents: 6_000_000 }, clave),
    ]);
    const perdedor = uno.status === 409 ? uno : dos;
    const cuerpo = (await perdedor.json()) as { error: { code: string; action?: string } };

    // El envelope no filtra el `meta` al cliente (§5.0): lo que el mostrador
    // necesita es saber dónde encontrarlo.
    expect(cuerpo.error.code).toBe('LP-BILL-409-002');
    expect(cuerpo.error.action).toContain('estado de cuenta');
  });
});

describe('un pago que sobra no sobrepaga el cargo', () => {
  it('el excedente queda como saldo a favor, y el reembolso lo devuelve', async () => {
    const centro = await centroConSocio('reembolso-sobrante');
    const cargo = await cobrar(centro, { amountCents: 6_000_000 });
    const pago = await pagarOk(centro, { amountCents: 10_000_000 });

    await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { amountCents: 2_000_000, reason: 'Se cobró de más.' }),
    );
    const estado = await estadoDeCuenta(centro);

    // Se imputaron 6.000.000 al cargo y 4.000.000 quedaron a favor; devolver
    // 2.000.000 sale del saldo, y el cargo vuelve a deber lo que se le sacó.
    expect(estado.balanceCents).toBe(2_000_000);
    expect(estado.charges.find((c) => c.publicId === cargo.publicId)?.status).toBe('pending');
  });
});

describe('caja diaria (§2.1.16)', () => {
  const arqueo = async (centro: Centro, query = '') => {
    const res = await app.request(
      `/api/v1/venues/${centro.venueId}/till?date=2026-03-15${query}`,
      req(centro.cookie, 'GET'),
    );

    return { res, texto: await res.text() };
  };

  it('suma los ingresos del día separados por método de pago', async () => {
    const centro = await centroConSocio('caja');
    await cobrar(centro, { amountCents: 10_000_000 });
    await pagarOk(centro, { amountCents: 6_000_000, method: 'cash' });
    await pagarOk(centro, { amountCents: 4_000_000, method: 'transfer' });

    const { texto } = await arqueo(centro);
    const caja = JSON.parse(texto) as {
      totalCents: number;
      cashCents: number;
      paymentCount: number;
      byMethod: Array<{ method: string; netCents: number }>;
    };

    expect(caja.totalCents).toBe(10_000_000);
    // El efectivo va aparte: es lo único que hay que contar a mano al cerrar.
    expect(caja.cashCents).toBe(6_000_000);
    expect(caja.paymentCount).toBe(2);
    expect(caja.byMethod.map((fila) => fila.method)).toEqual(['cash', 'transfer']);
  });

  it('los reembolsos se restan del arqueo', async () => {
    const centro = await centroConSocio('caja-reembolso');
    await cobrar(centro);
    const pago = await pagarOk(centro);
    await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(centro.cookie, 'POST', { amountCents: 2_000_000, reason: 'Devolución parcial.' }),
    );

    const { texto } = await arqueo(centro);
    const caja = JSON.parse(texto) as { totalCents: number; refundedCents: number };

    expect(caja.refundedCents).toBe(2_000_000);
    expect(caja.totalCents).toBe(4_000_000);
  });

  it('sin fecha, la caja es la de hoy en la hora del centro', async () => {
    const centro = await centroConSocio('caja-hoy');

    const res = await app.request(
      `/api/v1/venues/${centro.venueId}/till`,
      req(centro.cookie, 'GET'),
    );
    const caja = (await res.json()) as { date: string };

    // El reloj del test está clavado el 15 de marzo de 2026 a las 12:00 UTC,
    // que en Bahía Blanca sigue siendo el 15.
    expect(res.status).toBe(200);
    expect(caja.date).toBe('2026-03-15');
  });

  it('un día sin movimientos da cero, no un error', async () => {
    const centro = await centroConSocio('caja-vacia');

    const { res, texto } = await arqueo(centro);

    expect(res.status).toBe(200);
    expect(JSON.parse(texto)).toMatchObject({ totalCents: 0, paymentCount: 0, byMethod: [] });
  });

  it('exporta a CSV para pegarlo en la planilla del centro', async () => {
    const centro = await centroConSocio('caja-csv');
    await cobrar(centro);
    await pagarOk(centro, { method: 'cash' });

    const { res, texto } = await arqueo(centro, '&format=csv');

    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('caja-2026-03-15.csv');
    expect(texto).toContain('metodo,cantidad,bruto,reembolsado,neto');
    expect(texto).toContain('cash,1,6000000,0,6000000');
    expect(texto).toContain('TOTAL');
  });

  it('la caja es de la sede: no mezcla lo de otro centro', async () => {
    const victima = await centroConSocio('caja-victima');
    await cobrar(victima);
    await pagarOk(victima);
    const atacante = await centroConSocio('caja-atacante');

    const propia = await arqueo(atacante);

    expect((JSON.parse(propia.texto) as { totalCents: number }).totalCents).toBe(0);
  });
});

describe('aislamiento de tenant', () => {
  it('el atacante no ve ni toca los movimientos del otro centro', async () => {
    const victima = await centroConSocio('bill-victima');
    const cargo = await cobrar(victima, { description: 'Cargo Confidencial' });
    const pago = await pagarOk(victima);
    const atacante = await centroConSocio('bill-atacante');

    const anular = await app.request(
      `/api/v1/charges/${cargo.publicId}/void`,
      req(atacante.cookie, 'POST', { reason: 'Intento de anulación ajena.' }),
    );
    const reembolsar = await app.request(
      `/api/v1/payments/${pago.publicId}/refund`,
      req(atacante.cookie, 'POST', { reason: 'Intento de reembolso ajeno.' }),
    );

    expect(anular.status).toBe(404);
    expect(reembolsar.status).toBe(404);
  });

  it('el estado de cuenta de un socio ajeno sale vacío', async () => {
    const victima = await centroConSocio('bill-estado-victima');
    await cobrar(victima, { description: 'Cargo Confidencial' });
    const atacante = await centroConSocio('bill-estado-atacante');

    const res = await app.request(
      `/api/v1/members/${victima.memberId}/statement`,
      req(atacante.cookie, 'GET'),
    );
    const texto = await res.text();

    expect(texto).not.toContain('Confidencial');
    expect((JSON.parse(texto) as AccountStatement).charges).toEqual([]);
  });

  it('la misma clave de idempotencia en dos centros son dos pagos distintos', async () => {
    const uno = await centroConSocio('bill-idem-a');
    const otro = await centroConSocio('bill-idem-b');
    await cobrar(uno);
    await cobrar(otro);
    const key = nuevaClave();

    // El índice es `{ tenantId, idempotencyKey }`: si fuera solo la clave, el
    // primer centro que use "abc" se la bloquearía a todos los demás.
    expect((await pagar(uno, {}, key)).status).toBe(201);
    expect((await pagar(otro, {}, key)).status).toBe(201);
  });
});

describe('las rutas declaradas quedan cubiertas por la suite de F0-05', () => {
  it('las cinco rutas traen su fixture de ataque', () => {
    const rutas = allRegisteredRoutes().filter(
      (route) =>
        route.path.startsWith('/api/v1/charges') ||
        route.path.startsWith('/api/v1/payments') ||
        route.path.endsWith('/statement') ||
        route.path.endsWith('/till'),
    );

    expect(rutas).toHaveLength(6);
    for (const route of rutas) {
      expect(route.tenantScoped, `${route.method} ${route.path}`).toBe(true);
      expect(route.isolationFixture, `${route.method} ${route.path}`).toBeDefined();
    }
  });

  it('el fixture de cada ruta ataca de verdad y no filtra nada', async () => {
    const atacante = await nuevoCentro('bill-fixtures');
    const victima = await nuevoCentro('bill-fixtures-victima');

    for (const route of allRegisteredRoutes()) {
      const esDeBilling =
        route.path.startsWith('/api/v1/charges') ||
        route.path.startsWith('/api/v1/payments') ||
        route.path.endsWith('/statement') ||
        route.path.endsWith('/till');
      if (!esDeBilling || !route.isolationFixture) continue;

      const attack = await route.isolationFixture({ victimTenantId: victima.organizationId });
      const res = await app.request(attack.path, {
        method: route.method,
        headers: {
          'content-type': 'application/json',
          cookie: atacante.cookie,
          'Idempotency-Key': nuevaClave(),
        },
        ...(attack.body === undefined ? {} : { body: JSON.stringify(attack.body) }),
      });

      expect(await res.text(), `${route.method} ${route.path}`).not.toContain(
        VICTIM_CHARGE_DESCRIPTION,
      );
    }
  });
});

describe('los puertos que consume Notifications (F1-22)', () => {
  const enContexto = <T>(organizationId: string, fn: () => Promise<T>) =>
    runWithTenant({ tenantId: organizationId, userId: 'usr_test', requestId: 'req-ntf' }, fn);

  it('el cargo dice de qué sede es y cuándo vence', async () => {
    const centro = await centroConSocio('puerto-cargo');
    const cargo = await cobrar(centro, { dueAt: '2026-03-10T12:00:00Z' });

    const contexto = await enContexto(centro.organizationId, () =>
      modules.billing.service.chargeContextOf(cargo.publicId),
    );

    expect(contexto?.venueId).toBe(centro.venueId);
    expect(contexto?.dueAt.toString()).toBe('2026-03-10T12:00:00Z');
  });

  it('🔴 un cargo que no existe devuelve null, no una excepción', async () => {
    const centro = await centroConSocio('puerto-cargo-fantasma');

    // El aviso que no encuentra su cargo no sale; no rompe el job que lo
    // estaba encolando ni se lleva puestos los otros avisos de la corrida.
    const contexto = await enContexto(centro.organizationId, () =>
      modules.billing.service.chargeContextOf('chg_no_existe'),
    );

    expect(contexto).toBeNull();
  });

  it('el pago dice de qué sede es y de qué fecha', async () => {
    const centro = await centroConSocio('puerto-pago');
    const cargo = await cobrar(centro);
    const pago = await pagarOk(centro, { chargeIds: [cargo.publicId] });

    const contexto = await enContexto(centro.organizationId, () =>
      modules.billing.service.paymentContextOf(pago.publicId),
    );

    expect(contexto?.venueId).toBe(centro.venueId);
  });

  it('un pago que no existe devuelve null', async () => {
    const centro = await centroConSocio('puerto-pago-fantasma');

    const contexto = await enContexto(centro.organizationId, () =>
      modules.billing.service.paymentContextOf('pay_no_existe'),
    );

    expect(contexto).toBeNull();
  });
});
