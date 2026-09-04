import { Hono } from 'hono';
import type { Temporal } from '@js-temporal/polyfill';
import {
  contactRequestResultSchema,
  contactRequestSchema,
  type ContactRequestInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../app.js';
import { AppError } from '../../http/errors.js';
import { registerRoutes } from '../../http/route-registry.js';
import { validated } from '../../http/validate.js';
import { CrmService } from './application/crm-service.js';

/**
 * Interfaz publica del modulo CRM. En Fase 1 es solo la captura del formulario
 * de la landing; el pipeline de leads de un centro es Fase 4 (§2.1.21).
 */
export interface CrmModule {
  routes: Hono<AppEnv>;
  service: CrmService;
}

export function createCrmModule(deps: { now: () => Temporal.Instant }): CrmModule {
  const service = new CrmService({ now: deps.now });

  registerRoutes([
    {
      method: 'POST',
      path: '/api/v1/contact',
      /*
       * Publico y sin sesion: es el formulario de la landing, y quien escribe
       * todavia no tiene cuenta. No hay nada de ningun centro en juego — el
       * pedido no toca ninguna coleccion con `tenantId`.
       */
      tenantScoped: false,
      summary: 'Dejar una consulta desde la landing',
      tags: ['crm'],
      request: { body: contactRequestSchema },
      response: { status: 201, schema: contactRequestResultSchema },
      errorCodes: ['LP-CRM-422-001'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  routes.post(
    '/api/v1/contact',
    validated<ContactRequestInput, AppEnv>(
      contactRequestSchema,
      async (c, input) => c.json(await service.receive(input), 201),
      {
        /*
         * El diccionario promete un codigo propio para el formulario (§11.2):
         * "revisa los datos" a secas no le dice al visitante que arreglar.
         */
        mapIssues: (issues) =>
          new AppError({
            code: 'LP-CRM-422-001',
            status: 422,
            message: `Revisá los datos del formulario: ${issues
              .map((issue) => `${issue.path.join('.') || 'formulario'}: ${issue.message}`)
              .join(' · ')}`,
            meta: { issues },
          }),
      },
    ),
  );

  return { routes, service };
}

export type { CrmService } from './application/crm-service.js';
