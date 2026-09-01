import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Temporal } from '@js-temporal/polyfill';
import type { Db } from 'mongodb';
import { createMongoJobLock } from '../src/jobs/lock.js';
import { createJobRunner } from '../src/jobs/runner.js';
import { createLogger } from '../src/observability/logger.js';

/**
 * F0-08. El lock es la pieza critica: si falla, dos instancias corren el mismo
 * job y se duplican cobros, avisos y metricas. Se testea con la misma exigencia
 * que la reserva concurrente.
 */
let replSet: MongoMemoryReplSet;
let db: Db;

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

let now = Temporal.Instant.from('2026-09-01T03:00:00Z');
const clock = () => now;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_jobs_test' });
  db = mongoose.connection.db as Db;
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  now = Temporal.Instant.from('2026-09-01T03:00:00Z');
  await db.collection('jobLock').deleteMany({});
  await db.collection('jobRun').deleteMany({});
});

describe('lock', () => {
  it('lo toma el primero que llega', async () => {
    const lock = createMongoJobLock(db, 'instancia-a');

    expect(await lock.acquire('computeMetricsDaily', 300, now)).toBe(true);
  });

  it('el segundo no lo consigue mientras el primero lo tiene', async () => {
    const a = createMongoJobLock(db, 'instancia-a');
    const b = createMongoJobLock(db, 'instancia-b');

    expect(await a.acquire('computeMetricsDaily', 300, now)).toBe(true);
    expect(await b.acquire('computeMetricsDaily', 300, now)).toBe(false);
  });

  it('N intentos simultaneos: gana exactamente uno', async () => {
    const locks = Array.from({ length: 20 }, (_, i) => createMongoJobLock(db, `instancia-${i}`));

    const results = await Promise.all(locks.map((l) => l.acquire('dunning', 300, now)));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('vencido el TTL, otra instancia lo retoma: un proceso muerto no lo deja colgado', async () => {
    const a = createMongoJobLock(db, 'instancia-a');
    const b = createMongoJobLock(db, 'instancia-b');
    await a.acquire('markNoShows', 60, now);

    expect(await b.acquire('markNoShows', 60, now.add({ seconds: 30 }))).toBe(false);
    expect(await b.acquire('markNoShows', 60, now.add({ seconds: 61 }))).toBe(true);
  });

  it('al liberarlo, otro lo toma de inmediato', async () => {
    const a = createMongoJobLock(db, 'instancia-a');
    const b = createMongoJobLock(db, 'instancia-b');
    await a.acquire('dunning', 300, now);
    await a.release('dunning');

    expect(await b.acquire('dunning', 300, now)).toBe(true);
  });

  it('una instancia no puede liberar el lock de otra', async () => {
    const a = createMongoJobLock(db, 'instancia-a');
    const b = createMongoJobLock(db, 'instancia-b');
    await a.acquire('dunning', 300, now);

    await b.release('dunning');

    expect(await b.acquire('dunning', 300, now)).toBe(false);
  });

  it('dos jobs distintos no se estorban', async () => {
    const lock = createMongoJobLock(db, 'instancia-a');

    expect(await lock.acquire('dunning', 300, now)).toBe(true);
    expect(await lock.acquire('markNoShows', 300, now)).toBe(true);
  });
});

describe('runner', () => {
  const build = (enabled = true) =>
    createJobRunner({ db, logger, enabled, instanceId: 'instancia-a', now: clock });

  it('corre el handler y devuelve ok', async () => {
    const runner = build();
    const handler = vi.fn(async () => Promise.resolve());
    runner.register({ name: 'demo', cron: '0 3 * * *', handler });

    const result = await runner.run('demo');

    expect(result.status).toBe('ok');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('dos instancias a la misma hora: corre una sola', async () => {
    const shared = createMongoJobLock(db, 'compartido');
    const handler = vi.fn(async () => Promise.resolve());

    const a = createJobRunner({ db, logger, instanceId: 'a', now: clock, lock: shared });
    const b = createJobRunner({ db, logger, instanceId: 'b', now: clock, lock: shared });
    a.register({ name: 'computeMetricsDaily', cron: '0 3 * * *', handler });
    b.register({ name: 'computeMetricsDaily', cron: '0 3 * * *', handler });

    // La segunda encuentra el lock tomado porque la primera todavia no lo solto.
    const first = a.run('computeMetricsDaily');
    const second = b.run('computeMetricsDaily');
    const [r1, r2] = await Promise.all([first, second]);

    expect([r1.status, r2.status].sort()).toEqual(['ok', 'skipped']);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('un job que falla no tumba el proceso, y se registra', async () => {
    const runner = build();
    runner.register({
      name: 'reconcilePayments',
      cron: '0 4 * * *',
      handler: () => Promise.reject(new Error('Mercado Pago no responde')),
    });

    const result = await runner.run('reconcilePayments');

    expect(result.status).toBe('failed');
    expect(result.error).toContain('Mercado Pago');
  });

  it('el fallo queda en jobRun con su duracion, para el panel de salud del DFSA', async () => {
    const runner = build();
    runner.register({
      name: 'dunning',
      cron: '0 5 * * *',
      handler: () => Promise.reject(new Error('boom')),
    });

    await runner.run('dunning');

    const run = await db.collection('jobRun').findOne({ name: 'dunning' });
    expect(run?.['status']).toBe('failed');
    expect(run?.['error']).toBe('boom');
    expect(run?.['durationMs']).toBeGreaterThanOrEqual(0);
    expect(run?.['startedAt']).toBeDefined();
  });

  it('la corrida exitosa tambien queda registrada', async () => {
    const runner = build();
    runner.register({ name: 'demo', cron: '0 3 * * *', handler: () => Promise.resolve() });

    await runner.run('demo');

    const run = await db.collection('jobRun').findOne({ name: 'demo' });
    expect(run?.['status']).toBe('ok');
  });

  it('libera el lock aunque el job falle: si no, el fallo de hoy bloquea el de mañana', async () => {
    const runner = build();
    runner.register({
      name: 'dunning',
      cron: '0 5 * * *',
      handler: () => Promise.reject(new Error('boom')),
    });

    await runner.run('dunning');

    const otra = createMongoJobLock(db, 'instancia-b');
    expect(await otra.acquire('dunning', 300, now)).toBe(true);
  });

  it('correr dos veces seguidas funciona: el runner no impide reintentar', async () => {
    const runner = build();
    const handler = vi.fn(async () => Promise.resolve());
    runner.register({ name: 'demo', cron: '0 3 * * *', handler });

    await runner.run('demo');
    await runner.run('demo');

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('un job idempotente corrido dos veces deja el mismo resultado', async () => {
    const runner = build();
    // Simula `computeMetricsDaily`: upsert por (fecha), no insert.
    runner.register({
      name: 'computeMetricsDaily',
      cron: '0 3 * * *',
      handler: async () => {
        await db
          .collection('metricsDaily')
          .updateOne(
            { tenantId: 'org_1', date: '2026-09-01' },
            { $set: { attendances: 87 } },
            { upsert: true },
          );
      },
    });

    await runner.run('computeMetricsDaily');
    await runner.run('computeMetricsDaily');

    expect(await db.collection('metricsDaily').countDocuments()).toBe(1);
  });

  it('registrar dos veces el mismo nombre es un error de programacion', () => {
    const runner = build();
    runner.register({ name: 'demo', cron: '0 3 * * *', handler: () => Promise.resolve() });

    expect(() =>
      runner.register({ name: 'demo', cron: '0 4 * * *', handler: () => Promise.resolve() }),
    ).toThrowError(/duplicado/i);
  });

  it('correr un job que no existe es un error de programacion', async () => {
    const runner = build();

    await expect(runner.run('no-existe')).rejects.toThrowError(/no registrado/i);
  });

  it('con los jobs deshabilitados no se programa nada', () => {
    const runner = build(false);
    runner.register({ name: 'demo', cron: '* * * * *', handler: () => Promise.resolve() });

    runner.start();
    runner.stop();

    expect(runner.registered()).toHaveLength(1);
  });

  it('start programa lo registrado y stop lo apaga', () => {
    const runner = build();
    runner.register({ name: 'demo', cron: '0 3 * * *', handler: () => Promise.resolve() });

    expect(() => {
      runner.start();
      runner.stop();
    }).not.toThrow();
  });
});
