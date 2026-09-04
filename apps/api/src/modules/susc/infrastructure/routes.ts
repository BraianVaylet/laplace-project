import { Hono } from 'hono';
import { z } from 'zod';
import {
  changePlanSchema,
  changeSubscriberStatusSchema,
  fiscalDataSchema,
  impersonateSchema,
  impersonationSchema,
  planChangeResultSchema,
  healthPanelSchema,
  planIdSchema,
  planSchema,
  signUpSubscriberSchema,
  subscriptionSchema,
  subscriberUsageSchema,
  supportHitSchema,
  supportQuerySchema,
  updatePlanSchema,
  updatePlanPriceSchema,
  type ChangePlanInput,
  type ChangeSubscriberStatusInput,
  type FiscalData,
  type ImpersonateInput,
  type SignUpSubscriberInput,
  type UpdatePlanInput,
  type UpdatePlanPriceInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession, requireSuperAdmin, requireTwoFactor } from '../../../auth/session.js';
import { AppError } from '../../../http/errors.js';
import { registerRoutes } from '../../../http/route-registry.js';
import { parseQuery, validated } from '../../../http/validate.js';
import { requireTenant } from '../../../tenancy/context.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { SuscService } from '../application/susc-service.js';

const planParams = z.object({ planId: planIdSchema });
const organizationParams = z.object({ organizationId: z.string().min(1) });

export function createSuscRoutes(service: SuscService) {
  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/plans',
      /*
       * El catalogo es publico: lo muestra la landing, antes de que exista
       * ninguna sesion. No hay nada de ningun centro en la respuesta.
       */
      tenantScoped: false,
      summary: 'Los planes y sus precios',
      tags: ['susc'],
      response: { status: 200, schema: z.array(planSchema) },
      errorCodes: [],
    },
    {
      method: 'POST',
      path: '/api/v1/subscribers',
      /*
       * El alta crea la organizacion: no puede estar acotada a una que todavia
       * no existe. Exige sesion — hay que saber de quien va a ser la cuenta —
       * pero no organizacion activa.
       */
      tenantScoped: false,
      summary: 'Alta self-service de un suscriptor, con trial de 14 días',
      tags: ['susc'],
      request: { body: signUpSubscriberSchema },
      response: { status: 201, schema: subscriptionSchema },
      errorCodes: ['LP-SUSC-409-002', 'LP-SUBS-422-001', 'LP-AUTH-401-005'],
    },
    {
      method: 'GET',
      path: '/api/v1/subscription',
      tenantScoped: true,
      // La suscripcion sale de la sesion, nunca de un parametro: el atacante
      // solo puede pedir la suya, y la suya no existe hasta que se da de alta.
      isolationFixture: () => Promise.resolve({ path: '/api/v1/subscription' }),
      summary: 'Mi suscripción',
      tags: ['susc'],
      permission: { organization: ['update'] },
      response: { status: 200, schema: subscriptionSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/subscription/plan',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({ path: '/api/v1/subscription/plan', body: { planId: 'max' } }),
      summary: 'Cambiar de plan',
      tags: ['susc'],
      permission: { organization: ['update'] },
      request: { body: changePlanSchema },
      response: { status: 200, schema: planChangeResultSchema },
      errorCodes: ['LP-SUBS-422-001', 'LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'PUT',
      path: '/api/v1/subscription/fiscal',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/subscription/fiscal',
          body: {
            cuit: '20123456786',
            businessName: 'Sonda de aislamiento',
            ivaCondition: 'monotributo',
          },
        }),
      summary: 'Datos fiscales para el comprobante del SaaS',
      tags: ['susc'],
      permission: { organization: ['update'] },
      request: { body: fiscalDataSchema },
      response: { status: 200, schema: subscriptionSchema },
      errorCodes: ['LP-SUSC-422-001', 'LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/subscription/status',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({ path: '/api/v1/subscription/status', body: { to: 'cancelled' } }),
      summary: 'Cambiar el estado de la suscripción',
      tags: ['susc'],
      permission: { organization: ['delete'] },
      request: { body: changeSubscriberStatusSchema },
      response: { status: 200, schema: subscriptionSchema },
      errorCodes: ['LP-SUSC-422-001', 'LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  routes.get('/api/v1/plans', async (c) => c.json(await service.catalog()));

  routes.post(
    '/api/v1/subscribers',
    requireSession,
    validated<SignUpSubscriberInput, AppEnv>(signUpSubscriberSchema, async (c, input) =>
      c.json(await service.signUp(input, c.get('userId') as string), 201),
    ),
  );

  /*
   * Sin `requireModule`: la suscripcion se tiene que poder mirar aunque el
   * centro este suspendido — es justamente la pantalla donde vuelve a elegir
   * un plan. Un guard de entitlements ahi dejaria al suspendido sin salida.
   */
  for (const prefijo of ['/api/v1/subscription', '/api/v1/subscription/*'] as const) {
    routes.use(prefijo, requireSession);
    routes.use(prefijo, requireOrganization);
    routes.use(prefijo, tenantContext);
  }

  routes.get('/api/v1/subscription', requirePermission({ organization: ['update'] }), async (c) =>
    c.json(await service.mine(tenantOf())),
  );

  routes.post(
    '/api/v1/subscription/plan',
    requirePermission({ organization: ['update'] }),
    validated<ChangePlanInput, AppEnv>(changePlanSchema, async (c, input) =>
      c.json(await service.changePlan(tenantOf(), input.planId)),
    ),
  );

  routes.put(
    '/api/v1/subscription/fiscal',
    requirePermission({ organization: ['update'] }),
    validated<FiscalData, AppEnv>(fiscalDataSchema, async (c, input) =>
      c.json(await service.setFiscal(tenantOf(), input)),
    ),
  );

  routes.post(
    '/api/v1/subscription/status',
    requirePermission({ organization: ['delete'] }),
    validated<ChangeSubscriberStatusInput, AppEnv>(changeSubscriberStatusSchema, async (c, input) =>
      c.json(await service.changeStatus(tenantOf(), input)),
    ),
  );

  return routes;
}

/**
 * Las rutas del SAU. Van aparte porque **no son de un centro**: el super admin
 * opera sobre todos, y montarlas con el resto haría que un guard de tenant las
 * acote a uno solo.
 *
 * La autorización del SAU la resuelve F1-27 (panel del DFSA). Hasta entonces
 * estas rutas existen pero exigen sesión, y la impersonación pide motivo.
 */
export function createSauRoutes(service: SuscService) {
  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/admin/subscribers',
      tenantScoped: false,
      summary: 'Los suscriptores con su plan, su estado y su uso',
      tags: ['susc'],
      response: { status: 200, schema: z.array(subscriberUsageSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-AUTH-401-005'],
    },
    {
      method: 'GET',
      path: '/api/v1/admin/health',
      tenantScoped: false,
      summary: 'Salud técnica: errores por código, jobs fallidos y webhooks',
      tags: ['susc'],
      response: { status: 200, schema: healthPanelSchema },
      errorCodes: ['LP-AUTH-403-002', 'LP-AUTH-401-005'],
    },
    {
      method: 'GET',
      path: '/api/v1/admin/support',
      tenantScoped: false,
      summary: 'Buscar qué pasó por requestId o por código de error',
      tags: ['susc'],
      request: { query: supportQuerySchema },
      response: { status: 200, schema: z.array(supportHitSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-422-006'],
    },
    {
      method: 'PUT',
      path: '/api/v1/admin/plans/:planId',
      tenantScoped: false,
      summary: 'Editar un plan: nombre, precio, descripción y qué incluye',
      tags: ['susc'],
      request: { params: planParams, body: updatePlanSchema },
      response: { status: 200, schema: planSchema },
      errorCodes: ['LP-SUBS-422-001', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/admin/subscribers/:organizationId/status',
      tenantScoped: false,
      summary: 'Cambiar el estado de un suscriptor, con motivo',
      tags: ['susc'],
      request: { params: organizationParams, body: changeSubscriberStatusSchema },
      response: { status: 200, schema: subscriptionSchema },
      errorCodes: ['LP-SUSC-422-001', 'LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'PUT',
      path: '/api/v1/admin/plans/:planId/price',
      tenantScoped: false,
      summary: 'Cambiar el precio de un plan (no afecta a los ya suscriptos)',
      tags: ['susc'],
      request: { params: planParams, body: updatePlanPriceSchema },
      response: { status: 200, schema: planSchema },
      errorCodes: ['LP-SUBS-422-001', 'LP-AUTH-401-005'],
    },
    {
      method: 'POST',
      path: '/api/v1/admin/impersonate',
      tenantScoped: false,
      summary: 'Entrar a una cuenta para dar soporte, con motivo y aviso',
      tags: ['susc'],
      request: { body: impersonateSchema },
      response: { status: 200, schema: impersonationSchema },
      errorCodes: ['LP-SUSC-403-003', 'LP-SYS-404-002', 'LP-AUTH-401-005'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  /*
   * 🔴 Todo `/api/v1/admin` exige SAU **y** segundo factor (§2.1.1). El super
   * admin ve el SaaS entero: sin 2FA, una sola contraseña filtrada compromete
   * a todos los centros a la vez.
   */
  for (const prefijo of ['/api/v1/admin/*'] as const) {
    routes.use(prefijo, requireSession);
    routes.use(prefijo, requireSuperAdmin);
    routes.use(prefijo, requireTwoFactor);
  }

  routes.get('/api/v1/admin/subscribers', async (c) => c.json(await service.subscribers()));

  routes.get('/api/v1/admin/health', async (c) => c.json(await service.health()));

  routes.get('/api/v1/admin/support', async (c) =>
    c.json(await service.support(parseQuery(supportQuerySchema, c.req.query()))),
  );

  routes.put(
    '/api/v1/admin/plans/:planId',
    validated<UpdatePlanInput, AppEnv>(updatePlanSchema, async (c, input) => {
      const { planId } = planParams.parse({ planId: c.req.param('planId') });

      return c.json(await service.updatePlan(planId, input));
    }),
  );

  routes.post(
    '/api/v1/admin/subscribers/:organizationId/status',
    validated<ChangeSubscriberStatusInput, AppEnv>(changeSubscriberStatusSchema, async (c, input) =>
      c.json(await service.changeStatus(c.req.param('organizationId') as string, input)),
    ),
  );

  routes.put(
    '/api/v1/admin/plans/:planId/price',
    validated<UpdatePlanPriceInput, AppEnv>(updatePlanPriceSchema, async (c, input) => {
      const { planId } = planParams.parse({ planId: c.req.param('planId') });

      return c.json(await service.updatePlanPrice(planId, input));
    }),
  );

  routes.post(
    '/api/v1/admin/impersonate',
    validated<ImpersonateInput, AppEnv>(
      impersonateSchema,
      async (c, input) => c.json(await service.impersonate(input, c.get('userId') as string)),
      {
        /*
         * Sin motivo no se entra (§2.1.3): el codigo lo dice explicito en vez
         * de esconderlo detras de un "datos invalidos" generico.
         */
        mapIssues: (issues) =>
          issues.some((issue) => issue.path[0] === 'reason')
            ? impersonationWithoutReason()
            : undefined,
      },
    ),
  );

  return routes;
}

/**
 * El centro con el que se opera. Sale del contexto que abrio `tenantContext`,
 * que a su vez lo saco de la organizacion activa de la sesion (ADR-000 regla
 * 2). Nunca de un parametro: por eso estas rutas no tienen ninguno.
 */
function tenantOf(): string {
  return requireTenant().tenantId;
}

function impersonationWithoutReason() {
  return new AppError({
    code: 'LP-SUSC-403-003',
    status: 403,
    message: 'Indicá el motivo del acceso de soporte.',
    action: 'Escribí para qué necesitás entrar: le va a llegar al dueño de la cuenta.',
  });
}
