import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../src/persistence/collections.js';

/**
 * F0-10. Los indices de §5.2.3 se crean por migracion, nunca a mano en Atlas
 * (§6). Este test corre la migracion de verdad contra Mongo y verifica indice
 * por indice — incluidos los unicos, que son los que sostienen la idempotencia
 * y la no-sobreventa.
 */
const require = createRequire(import.meta.url);
const closures = require('../../../migrations/20260902160000-venue-closures.cjs') as {
  COLLECTIONS: Record<string, string>;
};
const tokens = require('../../../migrations/20260903120000-check-in-tokens.cjs') as {
  COLLECTIONS: Record<string, string>;
  up(db: Db): Promise<void>;
  INDEXES: Array<[string, Record<string, number>, Record<string, unknown>]>;
};
const migration = require('../../../migrations/20260901120000-mandatory-indexes.cjs') as {
  up(db: Db): Promise<void>;
  down(db: Db): Promise<void>;
  INDEXES: Array<[string, Record<string, number>, Record<string, unknown>]>;
  COLLECTIONS: Record<string, string>;
};

let replSet: MongoMemoryReplSet;
let db: Db;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_migrations_test' });
  db = mongoose.connection.db as Db;
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  for (const collection of await db.collections()) await collection.drop().catch(() => undefined);
});

async function indexesOf(collection: string) {
  return db.collection(collection).indexes();
}

describe('las migraciones y el codigo hablan de las mismas colecciones', () => {
  it('los nombres coinciden exactamente', () => {
    /*
     * Cada migracion declara las colecciones que trae; juntas tienen que cubrir
     * exactamente lo que el codigo usa. Una coleccion nueva sin su migracion
     * rompe acá, que es antes de que exista sin indices en produccion.
     */
    const declaradas = { ...migration.COLLECTIONS, ...closures.COLLECTIONS, ...tokens.COLLECTIONS };

    expect(declaradas).toEqual(COLLECTIONS);
  });
});

describe('los tokens del QR se limpian solos (F1-19)', () => {
  it('el TTL borra el token cuando vence, sin que nadie lo barra', async () => {
    await tokens.up(db);
    const indices = await indexesOf('checkInTokens');
    const ttl = indices.find((indice) => indice.name === 'checkin_token_ttl');

    /*
     * Se emite un token cada vez que alguien abre su QR: sin TTL la coleccion
     * crece para siempre. `expireAfterSeconds: 0` borra el documento cuando pasa
     * su propia `expiresAt`.
     */
    expect(ttl?.expireAfterSeconds).toBe(0);
    expect(ttl?.key).toEqual({ expiresAt: 1 });
  });

  it('el hash es unico por tenant: el canje es de un solo uso', async () => {
    await tokens.up(db);
    const indices = await indexesOf('checkInTokens');
    const unico = indices.find((indice) => indice.name === 'tenant_token_hash_unique');

    expect(unico?.unique).toBe(true);
    expect(unico?.key).toEqual({ tenantId: 1, tokenHash: 1 });
  });
});

describe('creacion de indices', () => {
  it('corre sobre una base vacia y deja todos los indices declarados', async () => {
    await migration.up(db);

    for (const [collection, , options] of migration.INDEXES) {
      const names = (await indexesOf(collection)).map((i) => i.name);
      expect(names, `${collection}.${String(options['name'])}`).toContain(options['name']);
    }
  });

  it('correrla dos veces no falla: los deploys se repiten', async () => {
    await migration.up(db);
    await expect(migration.up(db)).resolves.toBeUndefined();
  });

  it('el tenantId va PRIMERO en todo indice compuesto de negocio (ADR-000 regla 4)', async () => {
    const infra = new Set<string>([
      COLLECTIONS.loginAttempt,
      COLLECTIONS.jobLock,
      COLLECTIONS.jobRun,
    ]);
    // El RM es del atleta, no del centro, y el ejercicio global tampoco tiene tenant.
    const notTenantScoped = new Set<string>([
      COLLECTIONS.rmRecord,
      COLLECTIONS.consent,
      COLLECTIONS.exercise,
    ]);

    for (const [collection, keys, options] of migration.INDEXES) {
      if (infra.has(collection) || notTenantScoped.has(collection)) continue;

      const fields = Object.keys(keys);
      if (fields.length < 2) continue;

      expect(fields[0], `${collection}.${String(options['name'])}`).toBe('tenantId');
    }
  });
});

describe('los indices unicos, que son la ultima linea de defensa', () => {
  beforeEach(async () => {
    await migration.up(db);
  });

  it('bookings rechaza la doble reserva del mismo miembro en la misma clase', async () => {
    const booking = { tenantId: 'org_1', sessionId: 'ses_1', memberId: 'mem_1' };
    await db.collection(COLLECTIONS.booking).insertOne({ ...booking });

    await expect(db.collection(COLLECTIONS.booking).insertOne({ ...booking })).rejects.toThrowError(
      /duplicate key/i,
    );
  });

  it('pero deja reservar la misma clase a otro miembro', async () => {
    await db
      .collection(COLLECTIONS.booking)
      .insertOne({ tenantId: 'org_1', sessionId: 'ses_1', memberId: 'mem_1' });

    await expect(
      db
        .collection(COLLECTIONS.booking)
        .insertOne({ tenantId: 'org_1', sessionId: 'ses_1', memberId: 'mem_2' }),
    ).resolves.toBeDefined();
  });

  it('y no cruza centros: el mismo par en otro tenant es otra reserva', async () => {
    await db
      .collection(COLLECTIONS.booking)
      .insertOne({ tenantId: 'org_1', sessionId: 'ses_1', memberId: 'mem_1' });

    await expect(
      db
        .collection(COLLECTIONS.booking)
        .insertOne({ tenantId: 'org_2', sessionId: 'ses_1', memberId: 'mem_1' }),
    ).resolves.toBeDefined();
  });

  it('payments rechaza el mismo Idempotency-Key dos veces (§Testing.3)', async () => {
    await db
      .collection(COLLECTIONS.payment)
      .insertOne({ tenantId: 'org_1', idempotencyKey: 'idem-1', amountCents: 6_000_000 });

    await expect(
      db
        .collection(COLLECTIONS.payment)
        .insertOne({ tenantId: 'org_1', idempotencyKey: 'idem-1', amountCents: 6_000_000 }),
    ).rejects.toThrowError(/duplicate key/i);
  });

  it('pero deja registrar varios pagos manuales sin clave: el unico es parcial', async () => {
    await db.collection(COLLECTIONS.payment).insertOne({ tenantId: 'org_1', amountCents: 100 });

    await expect(
      db.collection(COLLECTIONS.payment).insertOne({ tenantId: 'org_1', amountCents: 200 }),
    ).resolves.toBeDefined();
  });

  it('members rechaza el documento repetido dentro del mismo centro', async () => {
    await db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_1', docId: '40123456' });

    await expect(
      db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_1', docId: '40123456' }),
    ).rejects.toThrowError(/duplicate key/i);
  });

  it('pero deja varios socios sin documento: con sparse a secas chocarian entre si', async () => {
    await db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_1', firstName: 'Ana' });

    await expect(
      db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_1', firstName: 'Juan' }),
    ).resolves.toBeDefined();
  });

  it('el mismo documento en otro centro se permite: son personas distintas para cada uno', async () => {
    await db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_1', docId: '40123456' });

    await expect(
      db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_2', docId: '40123456' }),
    ).resolves.toBeDefined();
  });

  it('metricsDaily rechaza el duplicado: es lo que hace idempotente al job', async () => {
    const row = { tenantId: 'org_1', venueId: 'ven_1', date: '2026-09-01' };
    await db.collection(COLLECTIONS.metricsDaily).insertOne({ ...row });

    await expect(
      db.collection(COLLECTIONS.metricsDaily).insertOne({ ...row }),
    ).rejects.toThrowError(/duplicate key/i);
  });

  it('el publicId es unico dentro de su coleccion', async () => {
    await db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_1', publicId: 'mem_abc' });

    await expect(
      db.collection(COLLECTIONS.member).insertOne({ tenantId: 'org_2', publicId: 'mem_abc' }),
    ).rejects.toThrowError(/duplicate key/i);
  });
});

describe('indices TTL', () => {
  beforeEach(async () => {
    await migration.up(db);
  });

  it('loginAttempt expira solo: los intentos viejos no se guardan para siempre', async () => {
    const index = (await indexesOf(COLLECTIONS.loginAttempt)).find(
      (i) => i.name === 'expiresAt_ttl',
    );

    expect(index?.['expireAfterSeconds']).toBe(0);
  });

  it('el audit log tiene retencion declarada', async () => {
    const index = (await indexesOf(COLLECTIONS.auditLog)).find((i) => i.name === 'at_ttl');

    expect(index?.['expireAfterSeconds']).toBeGreaterThan(0);
  });

  it('las corridas de job tambien', async () => {
    const index = (await indexesOf(COLLECTIONS.jobRun)).find((i) => i.name === 'startedAt_ttl');

    expect(index?.['expireAfterSeconds']).toBeGreaterThan(0);
  });
});

describe('reversion', () => {
  it('down saca los indices y deja solo el de _id', async () => {
    await migration.up(db);
    await migration.down(db);

    const names = (await indexesOf(COLLECTIONS.booking)).map((i) => i.name);
    expect(names).toEqual(['_id_']);
  });

  it('down no borra datos: revertir un indice no puede costar informacion', async () => {
    await migration.up(db);
    await db
      .collection(COLLECTIONS.member)
      .insertOne({ tenantId: 'org_1', firstName: 'Micaela', docId: '40123456' });

    await migration.down(db);

    expect(await db.collection(COLLECTIONS.member).countDocuments()).toBe(1);
  });

  it('down se puede correr dos veces', async () => {
    await migration.up(db);
    await migration.down(db);

    await expect(migration.down(db)).resolves.toBeUndefined();
  });
});
