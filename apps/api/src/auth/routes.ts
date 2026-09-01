import { Hono } from 'hono';
import type { Logger } from 'pino';
import { Temporal } from '@js-temporal/polyfill';
import type { ApiError } from '@laplace/schemas';
import { AUTH_BASE_PATH, type Auth } from './auth.js';
import { mapAuthError } from './error-mapping.js';

type Env = { Variables: { requestId: string } };

/**
 * Monta el handler de Better Auth bajo /api/v1/auth y traduce sus errores al
 * envelope unificado de la spec §5.0. Las respuestas exitosas pasan intactas:
 * llevan la cookie de sesion y no hay que tocarlas.
 */
export function createAuthRoutes(auth: Auth, logger: Logger) {
  const routes = new Hono<Env>();

  routes.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, async (c) => {
    const response = await auth.handler(c.req.raw);
    if (response.status < 400) return response;

    const requestId = c.get('requestId') ?? 'unknown';
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => undefined);
    const mapped = mapAuthError(response.status, body);

    logger.warn(
      {
        module: 'auth',
        action: `${c.req.method} ${c.req.path}`,
        requestId,
        errorCode: mapped.code,
        meta: { providerStatus: response.status },
      },
      mapped.message,
    );

    const envelope: ApiError = {
      success: false,
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.action === undefined ? {} : { action: mapped.action }),
        requestId,
        timestamp: Temporal.Now.instant().toString(),
      },
    };

    return c.json(envelope, mapped.status as 400 | 401 | 403 | 409 | 422 | 429 | 500);
  });

  return routes;
}
