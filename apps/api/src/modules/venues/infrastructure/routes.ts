import { Hono } from 'hono';
import { z, type ZodIssue } from 'zod';
import {
  createVenueSchema,
  paginatedSchema,
  paginationQuerySchema,
  updateVenueSchema,
  venueSchema,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  requireWithinLimit,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { AppError } from '../../../http/errors.js';
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { validated } from '../../../http/validate.js';
import { runWithTenant } from '../../../tenancy/context.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { VenueService } from '../application/venue-service.js';

const idParams = z.object({ id: z.string() });

/**
 * Una politica de reserva incoherente tiene su propio codigo (`LP-SCHD-422-001`)
 * y no cae en el generico: es el unico error de este modulo que el SMU puede
 * cometer configurando, y merece un mensaje que le diga que arreglar.
 */
function mapBookingPolicyIssues(issues: ZodIssue[]): AppError | undefined {
  const issue = issues.find((candidate) => candidate.path[0] === 'bookingPolicy');
  if (!issue) return undefined;

  return new AppError({
    code: 'LP-SCHD-422-001',
    status: 422,
    message: issue.message,
    meta: { path: issue.path.join('.') },
  });
}

/**
 * Rutas de Venues.
 *
 * Se declaran en el registro de F0-05 para que la suite de aislamiento las
 * recorra sola: una ruta bajo `/api/v1` sin registrar rompe el CI, y el olvido
 * tipico no es escribir mal el aislamiento sino agregar un endpoint y no
 * testearlo.
 */
export function createVenueRoutes(service: VenueService, entitlements: EntitlementsLoader) {
  /**
   * Siembra una sede del tenant victima y devuelve el path para atacarla. Lo
   * usa la suite de F0-05: sin esto, agregar una ruta no agrega su ataque.
   */
  const seedVictimVenue: IsolationFixture = async ({ victimTenantId }) => {
    const venue = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        service.create({
          name: 'Sede del otro centro',
          address: 'Calle Secreta 742, Springfield',
          timeZone: 'America/Argentina/Buenos_Aires',
          currency: 'ARS',
          businessHours: [],
        }),
    );

    return { path: `/api/v1/venues/${String(venue['publicId'])}` };
  };

  const seedAndList: IsolationFixture = async (context) => {
    await seedVictimVenue(context);
    return { path: '/api/v1/venues' };
  };

  /**
   * El ataque al alta no es leer: es escribir en el centro ajeno plantando un
   * `tenantId` en el body. Tiene que ignorarse por completo (ADR-000 regla 2).
   */
  const plantForeignTenant: IsolationFixture = ({ victimTenantId }) =>
    Promise.resolve({
      path: '/api/v1/venues',
      body: {
        tenantId: victimTenantId,
        name: 'Sede plantada',
        address: 'Calle Plantada 100, Springfield',
        timeZone: 'America/Argentina/Buenos_Aires',
      },
    });

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/venues',
      tenantScoped: true,
      isolationFixture: seedAndList,
      summary: 'Listado de sedes',
      tags: ['venues'],
      permission: { venue: ['read'] },
      request: { query: paginationQuerySchema },
      response: { status: 200, schema: paginatedSchema(venueSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/venues',
      tenantScoped: true,
      isolationFixture: plantForeignTenant,
      summary: 'Crear una sede',
      tags: ['venues'],
      permission: { venue: ['create'] },
      request: { body: createVenueSchema },
      response: { status: 201, schema: venueSchema },
      errorCodes: ['LP-ENTL-403-001', 'LP-SCHD-422-001', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/venues/:id',
      tenantScoped: true,
      isolationFixture: seedVictimVenue,
      summary: 'Ver una sede',
      tags: ['venues'],
      permission: { venue: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: venueSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/venues/:id',
      tenantScoped: true,
      isolationFixture: seedVictimVenue,
      summary: 'Editar una sede',
      tags: ['venues'],
      permission: { venue: ['update'] },
      request: { params: idParams, body: updateVenueSchema },
      response: { status: 200, schema: venueSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-SCHD-422-001', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/venues/:id/archive',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await seedVictimVenue(context)).path}/archive`,
      }),
      summary: 'Archivar una sede',
      tags: ['venues'],
      permission: { venue: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: venueSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-SCHD-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/venues/:id/restore',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await seedVictimVenue(context)).path}/restore`,
      }),
      summary: 'Reactivar una sede archivada',
      tags: ['venues'],
      permission: { venue: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: venueSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-SCHD-422-006', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  // El orden importa: sesion, organizacion activa, contexto de tenant y recien
  // ahi el plan. Cada capa depende de la anterior.
  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('schedule'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/venues', guard);
    routes.use('/api/v1/venues/*', guard);
  }

  routes.get('/api/v1/venues', requirePermission({ venue: ['read'] }), async (c) => {
    const query = paginationQuerySchema.parse(c.req.query());
    return c.json(await service.list(query.cursor, query.limit));
  });

  routes.post(
    '/api/v1/venues',
    requirePermission({ venue: ['create'] }),
    // El limite se evalua ANTES de escribir: crear y despues borrar deja huecos
    // en la numeracion y ruido en el historial.
    requireWithinLimit('venues', () => service.countActive()),
    validated(createVenueSchema, async (c, input) => c.json(await service.create(input), 201), {
      mapIssues: mapBookingPolicyIssues,
    }),
  );

  routes.get('/api/v1/venues/:id', requirePermission({ venue: ['read'] }), async (c) =>
    c.json(await service.getByPublicId(c.req.param('id'))),
  );

  routes.patch(
    '/api/v1/venues/:id',
    requirePermission({ venue: ['update'] }),
    validated(
      updateVenueSchema,
      async (c, input) => c.json(await service.update(c.req.param('id') as string, input)),
      { mapIssues: mapBookingPolicyIssues },
    ),
  );

  routes.post('/api/v1/venues/:id/archive', requirePermission({ venue: ['archive'] }), async (c) =>
    c.json(await service.changeStatus(c.req.param('id'), 'archived')),
  );

  routes.post('/api/v1/venues/:id/restore', requirePermission({ venue: ['archive'] }), async (c) =>
    c.json(await service.changeStatus(c.req.param('id'), 'active')),
  );

  return routes;
}
