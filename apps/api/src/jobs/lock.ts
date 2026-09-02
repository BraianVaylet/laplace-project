import { Temporal } from '@js-temporal/polyfill';
import type { Db, MongoServerError } from 'mongodb';
import { fromBsonDate, toBsonDate } from '../persistence/bson-date.js';

/**
 * Exclusion mutua entre instancias (ADR-006). El lock se toma con un
 * `findOneAndUpdate` condicionado por `expiresAt`, que es el mismo patron
 * atomico del cupo de una clase (§2.1.5.e): la garantia la da Mongo, no la
 * disciplina del codigo.
 *
 * El TTL importa tanto como el lock: si el proceso muere a mitad de un job, el
 * lock se libera solo y la proxima corrida lo retoma. Sin TTL, un crash deja el
 * job colgado para siempre.
 */
export interface JobLock {
  acquire(name: string, ttlSeconds: number, now: Temporal.Instant): Promise<boolean>;
  release(name: string): Promise<void>;
  heldBy(name: string): Promise<string | null>;
}

interface JobLockDoc {
  _id: string;
  instanceId: string;
  lockedAt: Date;
  expiresAt: Date;
}

const DUPLICATE_KEY = 11000;

export function createMongoJobLock(db: Db, instanceId: string): JobLock {
  const collection = db.collection<JobLockDoc>('jobLock');

  return {
    async acquire(name, ttlSeconds, now) {
      try {
        const result = await collection.findOneAndUpdate(
          // Solo si nadie lo tiene o si el que lo tenia ya vencio.
          { _id: name, expiresAt: { $lte: toBsonDate(now) } },
          {
            $set: {
              instanceId,
              lockedAt: toBsonDate(now),
              expiresAt: toBsonDate(now.add({ seconds: ttlSeconds })),
            },
          },
          { upsert: true, returnDocument: 'after' },
        );

        return result !== null;
      } catch (error) {
        // Con `upsert`, si el lock existe y sigue vigente el filtro no matchea y
        // Mongo intenta insertar: choca contra el _id y tira duplicate key.
        // Eso ES el caso "esta tomado", no un fallo.
        if ((error as MongoServerError).code === DUPLICATE_KEY) return false;
        throw error;
      }
    },

    async release(name) {
      await collection.deleteOne({ _id: name, instanceId });
    },

    async heldBy(name) {
      const doc = await collection.findOne({ _id: name });
      if (!doc) return null;

      const expired =
        Temporal.Instant.compare(Temporal.Now.instant(), fromBsonDate(doc.expiresAt)) >= 0;

      return expired ? null : doc.instanceId;
    },
  };
}
