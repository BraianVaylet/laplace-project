import { Hono } from 'hono';
import {
  dashboardQuerySchema,
  dashboardSchema,
  metricsQuerySchema,
  metricsRangeSchema,
  recomputeMetricsSchema,
  recomputeResultSchema,
  type RecomputeMetricsInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { authorize } from '../../../auth/permissions.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { registerRoutes } from '../../../http/route-registry.js';
import { parseQuery, validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { DashboardService } from '../application/dashboard-service.js';
import type { MetricsService } from '../application/metrics-service.js';

/** La sede y el numero que siembra `seedVictim`, para la suite de F0-05. */
export const VICTIM_VENUE_ID = 'ven_victima_metrics';
/** Un ingreso imposible de confundir: si aparece en la respuesta, hay fuga. */
export const VICTIM_INCOME_CENTS = 987_654_321;

export function createMetricsRoutes(
  service: MetricsService,
  dashboard: DashboardService,
  entitlements: EntitlementsLoader,
  seedVictim: (victimTenantId: string) => Promise<{ venueId: string }>,
) {
  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/dashboard',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/dashboard?venueId=${(await seedVictim(victimTenantId)).venueId}`,
      }),
      summary: 'El tablero operativo del día',
      tags: ['metrics'],
      /*
       * El coach SÍ entra: el tablero operativo es su pantalla de trabajo. Lo
       * que no ve es la plata, y eso se decide adentro del handler — no con un
       * permiso que le cerraría la puerta entera (§2.1.12).
       */
      permission: { classSession: ['read'] },
      request: { query: dashboardQuerySchema },
      response: { status: 200, schema: dashboardSchema },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-404-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/metrics',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/metrics?venueId=${(await seedVictim(victimTenantId)).venueId}`,
      }),
      summary: 'Los KPIs del centro, precalculados',
      tags: ['metrics'],
      /*
       * §2.1.12: el staff NO ve las métricas de negocio. Son privadas del SMU,
       * y un `coach` que las pide recibe 403, no una versión recortada.
       */
      permission: { businessMetrics: ['read'] },
      request: { query: metricsQuerySchema },
      response: { status: 200, schema: metricsRangeSchema },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-422-006', 'LP-SYS-404-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/metrics/recompute',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: '/api/v1/metrics/recompute',
        body: {
          venueId: (await seedVictim(victimTenantId)).venueId,
          from: '2026-03-01',
        },
      }),
      summary: 'Recalcular un día o un rango pasado',
      tags: ['metrics'],
      permission: { businessMetrics: ['read'] },
      request: { body: recomputeMetricsSchema },
      response: { status: 200, schema: recomputeResultSchema },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-422-006', 'LP-SYS-404-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('metrics'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/metrics', guard);
    routes.use('/api/v1/metrics/*', guard);
    routes.use('/api/v1/dashboard', guard);
  }

  routes.get('/api/v1/dashboard', requirePermission({ classSession: ['read'] }), async (c) => {
    const query = parseQuery(dashboardQuerySchema, c.req.query());
    const org = c.get('org') as unknown as { roles: string[] } | undefined;

    /*
     * La plata se decide acá y no con un permiso de ruta: el coach tiene que
     * poder abrir el tablero — es su pantalla de trabajo — y lo que le falta
     * es un bloque, no la pantalla entera.
     */
    const seesMoney = authorize(org?.roles ?? [], { billing: ['read'] });

    return c.json(await dashboard.of(query.venueId, { seesMoney }));
  });

  routes.get('/api/v1/metrics', requirePermission({ businessMetrics: ['read'] }), async (c) => {
    const query = parseQuery(metricsQuerySchema, c.req.query());

    return c.json(await service.panel(query.venueId, { from: query.from, to: query.to }));
  });

  routes.post(
    '/api/v1/metrics/recompute',
    requirePermission({ businessMetrics: ['read'] }),
    validated<RecomputeMetricsInput, AppEnv>(recomputeMetricsSchema, async (c, input) =>
      c.json({ venueId: input.venueId, recomputed: await service.recompute(input) }),
    ),
  );

  return routes;
}
