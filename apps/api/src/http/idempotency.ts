import { createMiddleware } from 'hono/factory';
import { AppError } from './errors.js';

/**
 * `Idempotency-Key` obligatorio en reservas, pagos, webhooks y check-in (§5.0).
 *
 * El middleware solo **exige y valida la clave**; la deduplicación real la hace
 * cada módulo con un índice único `{ tenantId, idempotencyKey }`. Es a
 * propósito: la única garantía que sirve es la de la base, y una caché de
 * respuestas en memoria se pierde justo cuando el proceso se reinicia, que es
 * cuando el cliente reintenta.
 *
 * Sin la clave, el reintento de un pago que falló por timeout cobra dos veces.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/** Suficiente para un UUID y para lo que genere un cliente razonable. */
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

export type IdempotencyEnv = { Variables: { idempotencyKey: string } };

export const requireIdempotencyKey = createMiddleware<IdempotencyEnv>(async (c, next) => {
  const key = c.req.header(IDEMPOTENCY_HEADER)?.trim();

  if (key === undefined || key.length === 0) {
    throw new AppError({
      code: 'LP-SYS-422-006',
      status: 422,
      message: `Falta el encabezado ${IDEMPOTENCY_HEADER}.`,
      action: 'Es obligatorio en pagos, reservas y check-in: evita cobrar o reservar dos veces.',
      meta: { header: IDEMPOTENCY_HEADER },
    });
  }

  if (key.length < MIN_LENGTH || key.length > MAX_LENGTH) {
    throw new AppError({
      code: 'LP-SYS-422-006',
      status: 422,
      message: `El ${IDEMPOTENCY_HEADER} tiene que tener entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres.`,
      meta: { header: IDEMPOTENCY_HEADER, length: key.length },
    });
  }

  c.set('idempotencyKey', key);

  await next();
});
