import { Temporal } from '@js-temporal/polyfill';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Logger } from 'pino';
import { createErrorHandler } from './http/error-handler.js';
import { requestId } from './http/request-id.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  logger: Logger;
  corsOrigins: string[];
}

export type AppEnv = { Variables: { requestId: string } };

/**
 * Fabrica de la app. Se exporta sin levantar el servidor para poder testearla
 * con `app.request()` sin abrir un puerto.
 */
export function createApp({ logger, corsOrigins }: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', requestId);
  app.use('*', secureHeaders());
  app.use('*', cors({ origin: corsOrigins, credentials: true }));

  app.route('/', healthRoutes);

  // Spec §5.0: versionado de API con prefijo /api/v1. Sin excepciones.
  const v1 = new Hono<AppEnv>();
  app.route('/api/v1', v1);

  app.notFound((c) =>
    c.json(
      {
        success: false,
        error: {
          code: 'LP-SYS-404-002',
          message: 'No encontramos lo que buscabas.',
          requestId: c.get('requestId') ?? 'unknown',
          timestamp: Temporal.Now.instant().toString(),
        },
      },
      404,
    ),
  );

  app.onError(createErrorHandler(logger));

  return app;
}

export type App = ReturnType<typeof createApp>;
