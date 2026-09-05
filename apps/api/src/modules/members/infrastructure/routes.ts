import { Hono } from 'hono';
import { z } from 'zod';
import {
  createMemberSchema,
  memberNoteResponseSchema,
  memberNoteSchema,
  memberOverviewSchema,
  memberResponseSchema,
  memberSearchHitSchema,
  memberSearchQuerySchema,
  memberStatusSchema,
  paginatedSchema,
  paginationQuerySchema,
  updateMemberSchema,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { authorize } from '../../../auth/permissions.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  requireWithinLimit,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { parseQuery, validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { MemberService } from '../application/member-service.js';
import type { MemberOverviewService } from '../application/member-overview-service.js';
import { toMemberResponse, toNoteResponse } from './member-response.js';

const idParams = z.object({ id: z.string() });
const listQuery = paginationQuerySchema.extend({
  status: memberStatusSchema.optional(),
  venueId: z.string().optional(),
  tag: z.string().optional(),
});
const changeStatusSchema = z.object({ to: memberStatusSchema });

/** Nombre del socio sembrado por los fixtures. Ninguna respuesta al atacante puede contenerlo. */
export const VICTIM_MEMBER_NAME = 'Secreta';

export function createMemberRoutes(
  service: MemberService,
  overview: MemberOverviewService,
  entitlements: EntitlementsLoader,
  /** Siembra un socio del tenant víctima. La arma el módulo, que tiene el repositorio. */
  seedVictimMember: (victimTenantId: string) => Promise<string>,
) {
  const attackMember: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/members/${await seedVictimMember(victimTenantId)}`,
  });

  const subPath =
    (suffix: string): IsolationFixture =>
    async (context) => ({ path: `${(await attackMember(context)).path}${suffix}` });

  const seedAndList: IsolationFixture = async ({ victimTenantId }) => {
    await seedVictimMember(victimTenantId);
    return { path: '/api/v1/members' };
  };

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/members',
      tenantScoped: true,
      isolationFixture: seedAndList,
      summary: 'Listado de socios',
      tags: ['members'],
      permission: { athlete: ['read'] },
      request: { query: listQuery },
      response: { status: 200, schema: paginatedSchema(memberResponseSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/members/search',
      tenantScoped: true,
      isolationFixture: async (context) => {
        await seedAndList(context);

        // Busca por el nombre del socio sembrado en el otro centro: si el
        // aislamiento fallara, el atacante lo encontraria por nombre.
        return { path: `/api/v1/members/search?q=${VICTIM_MEMBER_NAME}` };
      },
      summary: 'Buscador global de socios',
      tags: ['members'],
      permission: { athlete: ['read'] },
      request: { query: memberSearchQuerySchema },
      response: { status: 200, schema: z.array(memberSearchHitSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-422-006'],
    },
    {
      method: 'POST',
      path: '/api/v1/members',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/members',
          body: { firstName: 'Sin', lastName: 'Permiso', venueIds: ['ven_x'] },
        }),
      summary: 'Dar de alta un socio',
      tags: ['members'],
      permission: { athlete: ['create'] },
      request: { body: createMemberSchema },
      response: { status: 201, schema: memberResponseSchema },
      errorCodes: [
        'LP-MEMB-409-001',
        'LP-MEMB-422-004',
        'LP-ENTL-403-001',
        'LP-SYS-422-006',
        'LP-AUTH-403-002',
      ],
    },
    {
      method: 'GET',
      path: '/api/v1/members/:id',
      tenantScoped: true,
      isolationFixture: attackMember,
      summary: 'Ver la ficha de un socio',
      tags: ['members'],
      permission: { athlete: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: memberResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/members/:id',
      tenantScoped: true,
      isolationFixture: attackMember,
      summary: 'Editar la ficha de un socio',
      tags: ['members'],
      permission: { athlete: ['update'] },
      request: { params: idParams, body: updateMemberSchema },
      response: { status: 200, schema: memberResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-MEMB-409-001', 'LP-MEMB-422-004', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/members/:id/status',
      tenantScoped: true,
      isolationFixture: subPath('/status'),
      summary: 'Cambiar el estado del socio',
      tags: ['members'],
      permission: { athlete: ['update'] },
      request: { params: idParams, body: changeStatusSchema },
      response: { status: 200, schema: memberResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-MEMB-422-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/members/:id/suspend',
      tenantScoped: true,
      isolationFixture: subPath('/suspend'),
      summary: 'Sancionar a un socio',
      tags: ['members'],
      permission: { athlete: ['update'] },
      request: { params: idParams },
      response: { status: 200, schema: memberResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/members/:id/unsuspend',
      tenantScoped: true,
      isolationFixture: subPath('/unsuspend'),
      summary: 'Levantar la sanción de un socio',
      tags: ['members'],
      permission: { athlete: ['update'] },
      request: { params: idParams },
      response: { status: 200, schema: memberResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/members/:id/archive',
      tenantScoped: true,
      isolationFixture: subPath('/archive'),
      summary: 'Archivar a un socio',
      tags: ['members'],
      permission: { athlete: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: memberResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-MEMB-422-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/members/:id/overview',
      tenantScoped: true,
      isolationFixture: subPath('/overview'),
      summary: 'La ficha 360: contratos, próximas reservas, asistencia y waivers',
      tags: ['members'],
      /*
       * 🔴 Sin plata. El estado de cuenta vive en `/statement` con
       * `billing:read`: el coach abre esta pantalla todos los días y la deuda
       * del socio no es asunto suyo (§2.1.12).
       */
      permission: { athlete: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: memberOverviewSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/members/:id/notes',
      tenantScoped: true,
      isolationFixture: subPath('/notes'),
      summary: 'Notas internas del staff sobre un socio',
      tags: ['members'],
      // Permiso propio: `athlete.read` alcanza para ver la ficha, no las notas.
      permission: { athleteNote: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: z.array(memberNoteResponseSchema) },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/members/:id/notes',
      tenantScoped: true,
      isolationFixture: subPath('/notes'),
      summary: 'Escribir una nota interna',
      tags: ['members'],
      permission: { athleteNote: ['write'] },
      request: { params: idParams, body: memberNoteSchema },
      response: { status: 201, schema: memberNoteResponseSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('members'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/members', guard);
    routes.use('/api/v1/members/*', guard);
  }

  /*
   * 🔴 Quien ve plata y quien no (§2.1.12).
   *
   * No es un permiso de ruta: el coach tiene que poder abrir la ficha —es su
   * pantalla de trabajo— y lo que le falta es un dato, no la pantalla. Se
   * decide acá, del lado del servidor: mandar la deuda para que el front la
   * esconda es mandarla igual.
   */
  const veLaPlata = (c: { get: (key: 'org') => unknown }) =>
    authorize((c.get('org') as { roles: string[] } | undefined)?.roles ?? [], {
      billing: ['read'],
    });

  routes.get('/api/v1/members', requirePermission({ athlete: ['read'] }), async (c) => {
    const query = listQuery.parse(c.req.query());
    const page = await service.list(query, query.cursor, query.limit);
    const conPlata = veLaPlata(c);

    return c.json({
      items: page.items.map((doc) => toMemberResponse(doc, conPlata)),
      nextCursor: page.nextCursor,
    });
  });

  /*
   * Va antes que `/:id`: Hono resuelve por orden de registro, y con `/:id`
   * primero "search" se leeria como el publicId de un socio.
   */
  routes.get('/api/v1/members/search', requirePermission({ athlete: ['read'] }), async (c) => {
    const { q } = parseQuery(memberSearchQuerySchema, c.req.query());

    return c.json(await service.search(q));
  });

  routes.post(
    '/api/v1/members',
    requirePermission({ athlete: ['create'] }),
    // El límite se evalúa ANTES de escribir. Cuenta los que ocupan cupo, no los
    // históricos: archivar a los que se fueron no debe costar plata (§2.2.1).
    requireWithinLimit('activeMembers', () => service.countActive()),
    validated(createMemberSchema, async (c, input) =>
      c.json(toMemberResponse(await service.create(input), veLaPlata(c)), 201),
    ),
  );

  routes.get('/api/v1/members/:id', requirePermission({ athlete: ['read'] }), async (c) =>
    c.json(toMemberResponse(await service.getByPublicId(c.req.param('id')), veLaPlata(c))),
  );

  routes.patch(
    '/api/v1/members/:id',
    requirePermission({ athlete: ['update'] }),
    validated(updateMemberSchema, async (c, input) =>
      c.json(
        toMemberResponse(await service.update(c.req.param('id') as string, input), veLaPlata(c)),
      ),
    ),
  );

  routes.post(
    '/api/v1/members/:id/status',
    requirePermission({ athlete: ['update'] }),
    validated(changeStatusSchema, async (c, input) =>
      c.json(
        toMemberResponse(
          await service.changeStatus(c.req.param('id') as string, input.to),
          veLaPlata(c),
        ),
      ),
    ),
  );

  routes.post(
    '/api/v1/members/:id/suspend',
    requirePermission({ athlete: ['update'] }),
    async (c) =>
      c.json(toMemberResponse(await service.setSuspended(c.req.param('id'), true), veLaPlata(c))),
  );

  routes.post(
    '/api/v1/members/:id/unsuspend',
    requirePermission({ athlete: ['update'] }),
    async (c) =>
      c.json(toMemberResponse(await service.setSuspended(c.req.param('id'), false), veLaPlata(c))),
  );

  routes.post(
    '/api/v1/members/:id/archive',
    requirePermission({ athlete: ['archive'] }),
    async (c) =>
      c.json(
        toMemberResponse(await service.changeStatus(c.req.param('id'), 'archived'), veLaPlata(c)),
      ),
  );

  routes.get(
    '/api/v1/members/:id/overview',
    requirePermission({ athlete: ['read'] }),
    async (c) => {
      const memberId = c.req.param('id');
      // Se resuelve la ficha primero: pedir la 360 de alguien que no existe en
      // este centro tiene que dar 404, no una pantalla llena de vacíos.
      await service.getByPublicId(memberId);

      return c.json(await overview.of(memberId));
    },
  );

  routes.get('/api/v1/members/:id/notes', requirePermission({ athleteNote: ['read'] }), async (c) =>
    c.json((await service.listNotes(c.req.param('id'))).map(toNoteResponse)),
  );

  routes.post(
    '/api/v1/members/:id/notes',
    requirePermission({ athleteNote: ['write'] }),
    validated(memberNoteSchema, async (c, input) =>
      c.json(toNoteResponse(await service.addNote(c.req.param('id') as string, input)), 201),
    ),
  );

  return routes;
}
