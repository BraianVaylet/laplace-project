import type { Context } from 'hono';
import type { Logger } from 'pino';
import { AppError, statusOf, toErrorEnvelope } from './errors.js';

type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

/**
 * Handler global de errores. Todo error sale con el envelope de la spec §5.0 y
 * queda logueado con su errorCode y su requestId.
 */
export function createErrorHandler(logger: Logger) {
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

    return c.json(envelope, status as ErrorStatus);
  };
}
