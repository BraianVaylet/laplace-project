import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';
import { allRegisteredRoutes } from '../http/route-registry.js';
import { requireSession } from '../auth/session.js';
import { generateOpenApiDocument, type OpenApiOptions } from './generate.js';

export const OPENAPI_JSON_PATH = '/api/v1/openapi.json';
export const OPENAPI_UI_PATH = '/api/v1/docs';

export interface OpenApiRoutesDeps extends OpenApiOptions {
  /**
   * En produccion la doc pide sesion: el mapa completo de la API, con cada
   * parametro y cada codigo de error, no tiene por que ser publico.
   */
  requireAuth: boolean;
}

export function createOpenApiRoutes({ requireAuth, ...options }: OpenApiRoutesDeps) {
  const routes = new Hono();

  if (requireAuth) {
    routes.use(OPENAPI_JSON_PATH, requireSession);
    routes.use(OPENAPI_UI_PATH, requireSession);
  }

  // Se genera en cada pedido a proposito: asi refleja lo que la app tiene
  // montado ahora, no lo que tenia cuando arranco.
  routes.get(OPENAPI_JSON_PATH, (c) =>
    c.json(generateOpenApiDocument(allRegisteredRoutes(), options)),
  );

  routes.get(OPENAPI_UI_PATH, swaggerUI({ url: OPENAPI_JSON_PATH }));

  return routes;
}
