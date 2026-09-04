import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import { LANDING_PLANS } from '@laplace/schemas';
import { createApp } from '../src/app.js';
import { createEntitlementsLoader } from '../src/entitlements/middleware.js';
import { createEventBus } from '../src/events/bus.js';
import { resetRouteRegistry } from '../src/http/route-registry.js';
import { createModules } from '../src/modules/index.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F1-26. El formulario de contacto de la landing (§5.1.4).
 *
 * Es **público**: no hay sesión ni tenant. Lo que se verifica es que un robot
 * no llene la bandeja y que una persona nunca quede afuera por una defensa que
 * no entiende.
 */
const require = createRequire(import.meta.url);
const migration = require('../../../migrations/20260906090000-subscriptions.cjs') as {
  up(db: Db): Promise<void>;
  PLANS: Array<{ planId: string; priceCents: number; name: string }>;
};

let replSet: MongoMemoryReplSet;
let app: ReturnType<typeof createApp>;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const entitlements = createEntitlementsLoader(() => Promise.resolve({ planId: 'pro' }));
const ahora = Temporal.Instant.from('2026-03-02T12:00:00Z');

type ErrorBody = { success: false; error: { code: string; message: string } };

const enviar = (body: unknown) =>
  app.request('/api/v1/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const VALIDO = {
  name: 'Braian',
  email: 'braian@boxtoro.test',
  message: 'Tengo un box de 40 socios y quiero saber cuánto sale.',
};

const guardados = async () =>
  (await mongoose.connection.db?.collection('contactRequests').find().toArray()) ?? [];

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_crm_test' });
  await migration.up(mongoose.connection.db as Db);

  app = createApp({
    logger,
    corsOrigins: [],
    modules: createModules({
      events: createEventBus(logger),
      entitlements,
      logger,
      now: () => ahora,
      memberships: { add: () => Promise.resolve() },
    }).routes,
  });
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
  resetRouteRegistry();
});

beforeEach(async () => {
  await mongoose.connection.db?.collection('contactRequests').deleteMany({});
});

describe('el formulario de contacto (§5.1.4)', () => {
  it('🔴 no exige sesión: es la landing, quien escribe todavía no tiene cuenta', async () => {
    const res = await enviar(VALIDO);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ received: true });
    expect(await guardados()).toHaveLength(1);
  });

  it('guarda lo que sirve para contestar', async () => {
    await enviar({ ...VALIDO, phone: '+542914567890', centerName: 'Box Toro' });

    const [pedido] = await guardados();
    expect(pedido?.['email']).toBe('braian@boxtoro.test');
    expect(pedido?.['centerName']).toBe('Box Toro');
    expect(pedido?.['source']).toBe('landing');
  });

  it('el mail se normaliza a minúsculas: dos mails iguales no son dos personas', async () => {
    await enviar({ ...VALIDO, email: 'Braian@BoxToro.test' });

    expect((await guardados())[0]?.['email']).toBe('braian@boxtoro.test');
  });

  it('🔴 un formulario incompleto responde con el código del diccionario', async () => {
    const res = await enviar({ name: 'B', email: 'no-es-un-mail', message: 'corto' });
    const body = (await res.json()) as ErrorBody;

    expect(res.status).toBe(422);
    expect(body.error.code).toBe('LP-CRM-422-001');
    // El mensaje dice QUÉ está mal: "revisá los datos" a secas no alcanza.
    expect(body.error.message).toContain('email');
  });
});

describe('las defensas contra bots', () => {
  it('🔴 el que cae en la trampa recibe 201 y no se guarda nada', async () => {
    /*
     * Contestar un error le diría al robot qué cambiar para pasar. Se lo
     * descarta en silencio, y a la persona real no la afecta porque su pedido
     * sí se guardó.
     */
    const res = await enviar({ ...VALIDO, website: 'http://spam.example' });

    expect(res.status).toBe(201);
    expect(await guardados()).toHaveLength(0);
  });

  it('un mensaje que es solo publicidad se descarta igual', async () => {
    const publicidad = [
      'https://a.com',
      'https://b.com',
      'www.c.com',
      'https://d.com',
      'www.e.com',
    ].join(' ');

    await enviar({ ...VALIDO, message: publicidad });

    expect(await guardados()).toHaveLength(0);
  });

  it('🔴 quien pega el link de su gimnasio NO es spam', async () => {
    // Un corte demasiado bajo rechaza a un cliente real, que es peor que
    // aguantar una publicidad de vez en cuando.
    await enviar({
      ...VALIDO,
      message:
        'Mi box es https://boxtoro.test y estamos en www.instagram.com/boxtoro. ¿Cuánto sale?',
    });

    expect(await guardados()).toHaveLength(1);
  });
});

describe('los precios de la landing y los de la base dicen lo mismo', () => {
  it('🔴 no se puede cambiar uno y olvidarse del otro', async () => {
    /*
     * La landing hornea los precios en el HTML para que el buscador los lea
     * (§5.1.4), y la migración los siembra en la base. Son dos representaciones
     * de lo mismo en dos lenguajes que no pueden compartir código: lo único que
     * las mantiene sincronizadas es este test.
     */
    const sembrados = new Map(migration.PLANS.map((plan) => [plan.planId, plan]));

    for (const plan of LANDING_PLANS) {
      const sembrado = sembrados.get(plan.planId);

      expect(sembrado, `falta el plan ${plan.planId} en la migración`).toBeDefined();
      expect(sembrado?.priceCents, `precio de ${plan.planId}`).toBe(plan.priceCents);
      expect(sembrado?.name, `nombre de ${plan.planId}`).toBe(plan.name);
    }

    expect(migration.PLANS).toHaveLength(LANDING_PLANS.length);
  });
});
