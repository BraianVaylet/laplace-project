import { Hono } from 'hono';
import { z } from 'zod';
import {
  createRoomSchema,
  paginatedSchema,
  paginationQuerySchema,
  roomSchema,
  updateRoomSchema,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { RoomService } from '../application/room-service.js';

const idParams = z.object({ id: z.string() });
const listQuery = paginationQuerySchema.extend({ venueId: z.string().optional() });

/**
 * Rutas de Rooms.
 *
 * No llevan guard de límite de plan: el plan cuenta **Venues activos**, no
 * Rooms (§1.1). Un centro Basic puede tener las salas que quiera en su sede.
 */
export function createRoomRoutes(
  service: RoomService,
  entitlements: EntitlementsLoader,
  /**
   * Siembra una sala del tenant víctima y devuelve su `publicId`. La arma el
   * módulo, que es quien tiene el repositorio: las rutas no lo tocan.
   */
  seedVictimRoom: (victimTenantId: string) => Promise<{ roomId: string; venueId: string }>,
) {
  const attackRoom: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/rooms/${(await seedVictimRoom(victimTenantId)).roomId}`,
  });

  const seedAndList: IsolationFixture = async ({ victimTenantId }) => {
    await seedVictimRoom(victimTenantId);
    return { path: '/api/v1/rooms' };
  };

  /**
   * El ataque al alta no es leer: es colgar una sala de la sede del centro
   * ajeno. Tiene que dar 404, porque ese Venue no existe para el atacante.
   */
  const plantInForeignVenue: IsolationFixture = async ({ victimTenantId }) => ({
    path: '/api/v1/rooms',
    body: {
      venueId: (await seedVictimRoom(victimTenantId)).venueId,
      name: 'Sala plantada',
      capacity: 10,
    },
  });

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/rooms',
      tenantScoped: true,
      isolationFixture: seedAndList,
      summary: 'Listado de salas',
      tags: ['rooms'],
      permission: { room: ['read'] },
      request: { query: listQuery },
      response: { status: 200, schema: paginatedSchema(roomSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/rooms',
      tenantScoped: true,
      isolationFixture: plantInForeignVenue,
      summary: 'Crear una sala',
      tags: ['rooms'],
      permission: { room: ['create'] },
      request: { body: createRoomSchema },
      response: { status: 201, schema: roomSchema },
      errorCodes: ['LP-SCHD-404-008', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/rooms/:id',
      tenantScoped: true,
      isolationFixture: attackRoom,
      summary: 'Ver una sala',
      tags: ['rooms'],
      permission: { room: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: roomSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/rooms/:id',
      tenantScoped: true,
      isolationFixture: attackRoom,
      summary: 'Editar una sala',
      tags: ['rooms'],
      permission: { room: ['update'] },
      request: { params: idParams, body: updateRoomSchema },
      response: { status: 200, schema: roomSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/rooms/:id/archive',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await attackRoom(context)).path}/archive`,
      }),
      summary: 'Archivar una sala',
      tags: ['rooms'],
      permission: { room: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: roomSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-SCHD-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/rooms/:id/restore',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await attackRoom(context)).path}/restore`,
      }),
      summary: 'Reactivar una sala archivada',
      tags: ['rooms'],
      permission: { room: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: roomSchema },
      errorCodes: ['LP-SYS-404-002', 'LP-SCHD-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'DELETE',
      path: '/api/v1/rooms/:id',
      tenantScoped: true,
      isolationFixture: attackRoom,
      summary: 'Borrar una sala sin clases programadas',
      tags: ['rooms'],
      // La matriz de F0-02 no tiene `delete` para Room: el borrado es lógico y
      // vive en el mismo permiso destructivo que archivar.
      permission: { room: ['archive'] },
      request: { params: idParams },
      response: { status: 204, schema: z.object({}) },
      errorCodes: ['LP-SYS-404-002', 'LP-SCHD-409-002', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('schedule'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/rooms', guard);
    routes.use('/api/v1/rooms/*', guard);
  }

  routes.get('/api/v1/rooms', requirePermission({ room: ['read'] }), async (c) => {
    const query = listQuery.parse(c.req.query());
    return c.json(await service.list(query.venueId, query.cursor, query.limit));
  });

  routes.post(
    '/api/v1/rooms',
    requirePermission({ room: ['create'] }),
    validated(createRoomSchema, async (c, input) => c.json(await service.create(input), 201)),
  );

  routes.get('/api/v1/rooms/:id', requirePermission({ room: ['read'] }), async (c) =>
    c.json(await service.getByPublicId(c.req.param('id'))),
  );

  routes.patch(
    '/api/v1/rooms/:id',
    requirePermission({ room: ['update'] }),
    validated(updateRoomSchema, async (c, input) =>
      c.json(await service.update(c.req.param('id') as string, input)),
    ),
  );

  routes.post('/api/v1/rooms/:id/archive', requirePermission({ room: ['archive'] }), async (c) =>
    c.json(await service.changeStatus(c.req.param('id'), 'archived')),
  );

  routes.post('/api/v1/rooms/:id/restore', requirePermission({ room: ['archive'] }), async (c) =>
    c.json(await service.changeStatus(c.req.param('id'), 'active')),
  );

  routes.delete('/api/v1/rooms/:id', requirePermission({ room: ['archive'] }), async (c) => {
    await service.remove(c.req.param('id'));
    return c.body(null, 204);
  });

  return routes;
}
