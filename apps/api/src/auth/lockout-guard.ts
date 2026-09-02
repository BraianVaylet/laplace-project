import { Temporal } from '@js-temporal/polyfill';
import { createMiddleware } from 'hono/factory';
import type { Db } from 'mongodb';
import { AppError } from '../http/errors.js';
import { fromBsonDate, toBsonDate } from '../persistence/bson-date.js';
import {
  DEFAULT_LOCKOUT_POLICY,
  isBlocked,
  nextFailureState,
  type LockoutPolicy,
  type LockoutState,
} from './lockout.js';

const COLLECTION = 'loginAttempt';

interface LockoutDoc {
  _id: string;
  failures: number;
  firstFailureAt: Date;
  blockedUntil: Date | null;
  expiresAt: Date;
}

export interface LockoutStore {
  read(key: string): Promise<LockoutState | null>;
  write(key: string, state: LockoutState, ttlSeconds: number): Promise<void>;
  clear(key: string): Promise<void>;
}

/** Store en Mongo. El TTL limpia solo: los intentos viejos no se guardan para siempre. */
export function createMongoLockoutStore(db: Db): LockoutStore {
  const collection = db.collection<LockoutDoc>(COLLECTION);

  return {
    async read(key) {
      const doc = await collection.findOne({ _id: key });
      if (!doc) return null;

      return {
        failures: doc.failures,
        firstFailureAt: fromBsonDate(doc.firstFailureAt),
        blockedUntil: doc.blockedUntil ? fromBsonDate(doc.blockedUntil) : null,
      };
    },

    async write(key, state, ttlSeconds) {
      await collection.updateOne(
        { _id: key },
        {
          $set: {
            failures: state.failures,
            firstFailureAt: toBsonDate(state.firstFailureAt),
            blockedUntil: state.blockedUntil ? toBsonDate(state.blockedUntil) : null,
            expiresAt: toBsonDate(state.firstFailureAt.add({ seconds: ttlSeconds })),
          },
        },
        { upsert: true },
      );
    },

    async clear(key) {
      await collection.deleteOne({ _id: key });
    },
  };
}

/** Normaliza el email para que `A@B.com` y `a@b.com` cuenten como la misma cuenta. */
function lockoutKeyFor(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

async function emailFromRequest(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();
    if (typeof body !== 'object' || body === null) return null;
    const email = (body as Record<string, unknown>)['email'];
    return typeof email === 'string' && email.length > 0 ? email : null;
  } catch {
    return null;
  }
}

export interface LockoutGuardDeps {
  store: LockoutStore;
  policy?: LockoutPolicy;
  /** Inyectable para poder testear la escalera sin esperar en tiempo real. */
  now?: () => Temporal.Instant;
}

/**
 * Bloqueo progresivo por cuenta sobre el login (spec §2.1.1). Va delante del
 * handler de Better Auth: si la cuenta esta bloqueada corta antes de tocar la
 * base, y si el intento falla suma un fallo.
 *
 * El rate limit por IP y esto son defensas distintas y ninguna reemplaza a la
 * otra: la IP se rota barato, la cuenta no.
 */
export function createLockoutGuard({ store, policy, now }: LockoutGuardDeps) {
  const rules = policy ?? DEFAULT_LOCKOUT_POLICY;
  const clock = now ?? (() => Temporal.Now.instant());

  return createMiddleware(async (c, next) => {
    const email = await emailFromRequest(c.req.raw);
    if (!email) return next();

    const key = lockoutKeyFor(email);
    const current = await store.read(key);
    const at = clock();

    if (isBlocked(current, at)) {
      const until = current?.blockedUntil;
      throw new AppError({
        code: 'LP-AUTH-403-006',
        status: 403,
        message: 'La cuenta está bloqueada por seguridad.',
        action: until
          ? `Probá de nuevo después de las ${until.toZonedDateTimeISO('UTC').toPlainTime().toString({ smallestUnit: 'minute' })} UTC.`
          : 'Probá de nuevo en unos minutos.',
        // Nunca el email: el log no es lugar para datos de la cuenta que se ataca.
        meta: { failures: current?.failures },
      });
    }

    await next();

    if (c.res.status === 401) {
      const state = nextFailureState(current, at, rules);
      await store.write(key, state, rules.windowSeconds + rules.maxBlockSeconds);
      return;
    }

    if (c.res.status < 400 && current) await store.clear(key);
  });
}
