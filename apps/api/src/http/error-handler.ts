import type { Context } from 'hono';
import type { Logger } from 'pino';
import type { ErrorEventStore } from '../observability/error-events.js';
import { AppError, statusOf, toErrorEnvelope } from './errors.js';

type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

/**
 * Handler global de errores. Todo error sale con el envelope de la spec §5.0 y
 * queda logueado con su errorCode y su requestId.
 */
export function createErrorHandler(logger: Logger, events?: ErrorEventStore) {
  return (error: Error, c: Context) => {
    const requestId = (c.get('requestId') as string | undefined) ?? 'unknown';
    const envelope = toErrorEnvelope(error, requestId);
    const status = statusOf(error);

    logger.error(
      {
        module: 'http',
        action: `${c.req.method} ${c.req.path}`,
        requestId,
        errorCode: envelope.error.code,
        ...(error instanceof AppError && error.meta ? { meta: error.meta } : {}),
        ...(error instanceof AppError ? {} : { stack: error.stack }),
      },
      error.message,
    );

    /*
     * El registro de soporte se escribe sin esperarlo y sin poder romper nada:
     * si la escritura falla, el usuario igual recibe su error con su
     * `requestId`. Un panel de soporte caido no puede convertir un 422 en un
     * 500.
     *
     * Va el codigo, no el contenido: el `meta` puede tener el nombre y el saldo
     * de un socio, y el SAU no ve datos de miembros (ADR-004, decision 7).
     */
    void events
      ?.record({
        requestId,
        code: envelope.error.code,
        status,
        method: c.req.method,
        path: c.req.path,
        tenantId: (c.get('org') as { organizationId?: string } | undefined)?.organizationId ?? null,
      })
      .catch(() => undefined);

    return c.json(envelope, status as ErrorStatus);
  };
}
