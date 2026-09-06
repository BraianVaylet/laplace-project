import { Hono } from 'hono';
import { z } from 'zod';
import {
  createInviteCodeSchema,
  inviteCodeSchema,
  paginatedSchema,
  paginationQuerySchema,
  redeemInviteCodeSchema,
  redeemResultSchema,
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
import { parseQuery, validated } from '../../../http/validate.js';
import { fromBsonDate } from '../../../persistence/bson-date.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { InviteCodeService } from '../application/invite-code-service.js';
import type { InviteCodeDoc } from './invite-code.model.js';

const idParams = z.object({ id: z.string() });

/**
 * Rutas de códigos de invitación.
 *
 * El permiso es `athlete.create` y no `invitation.create`: `invitation` está
 * reservado por Better Auth para invitar **staff** (F0-02). Darle
 * `invitation.create` a un recepcionista para que genere códigos de socios le
 * daría también permiso para sumar usuarios con rol.
 */
export function createInviteCodeRoutes(
  service: InviteCodeService,
  entitlements: EntitlementsLoader,
  /** Siembra un código del tenant víctima. La arma el módulo, que tiene el repositorio. */
  seedVictimCode: (victimTenantId: string) => Promise<{ id: string; code: string }>,
) {
  const attackCode: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/invite-codes/${(await seedVictimCode(victimTenantId)).id}/revoke`,
  });

  const seedAndList: IsolationFixture = async ({ victimTenantId }) => {
    await seedVictimCode(victimTenantId);
    return { path: '/api/v1/invite-codes' };
  };

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/invite-codes',
      tenantScoped: true,
      isolationFixture: seedAndList,
      summary: 'Códigos de invitación del centro',
      tags: ['members'],
      permission: { athlete: ['create'] },
      request: { query: paginationQuerySchema },
      response: { status: 200, schema: paginatedSchema(inviteCodeSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002', 'LP-SYS-422-006'],
    },
    {
      method: 'POST',
      path: '/api/v1/invite-codes',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/invite-codes',
          body: { venueId: 'ven_ajena', maxUses: 1, expiresAt: '2099-01-01T00:00:00Z' },
        }),
      summary: 'Generar un código de invitación',
      tags: ['members'],
      permission: { athlete: ['create'] },
      request: { body: createInviteCodeSchema },
      response: { status: 201, schema: inviteCodeSchema },
      errorCodes: ['LP-MEMB-422-005', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/invite-codes/:id/revoke',
      tenantScoped: true,
      isolationFixture: attackCode,
      summary: 'Revocar un código',
      tags: ['members'],
      permission: { athlete: ['create'] },
      request: { params: idParams },
      response: { status: 200, schema: inviteCodeSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/invite-codes/redeem',
      /*
       * 🔴 La única ruta de negocio sin alcance de tenant, y con motivo: el canje
       * ocurre ANTES de que la persona pertenezca a ningún centro. El tenant sale
       * del código, que es el único dato que hay, y la búsqueda se sostiene sobre
       * el índice único GLOBAL de `code`. Exige sesión igual que todas: un canje
       * anónimo no tendría a quién asociar.
       */
      tenantScoped: false,
      summary: 'Canjear un código de invitación',
      tags: ['members'],
      request: { body: redeemInviteCodeSchema },
      response: { status: 200, schema: redeemResultSchema },
      errorCodes: ['LP-MEMB-422-005', 'LP-SYS-422-006', 'LP-AUTH-401-005'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  /*
   * El canje se monta ANTES de los guards de organización: quien lo usa todavía
   * no tiene una, que es justamente el punto.
   */
  routes.post(
    '/api/v1/invite-codes/redeem',
    requireSession,
    validated(redeemInviteCodeSchema, async (c, input) =>
      c.json(await service.redeem(input, c.get('userId') as string)),
    ),
  );

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('members'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/invite-codes', guard);
    routes.use('/api/v1/invite-codes/:id/revoke', guard);
  }

  routes.get('/api/v1/invite-codes', requirePermission({ athlete: ['create'] }), async (c) => {
    const query = parseQuery(paginationQuerySchema, c.req.query());
    const page = await service.list(query.cursor, query.limit);

    return c.json({
      items: page.items.map((code) => toResponse(code, service)),
      nextCursor: page.nextCursor,
    });
  });

  routes.post(
    '/api/v1/invite-codes',
    requirePermission({ athlete: ['create'] }),
    validated(createInviteCodeSchema, async (c, input) =>
      c.json(toResponse(await service.create(input), service), 201),
    ),
  );

  routes.post(
    '/api/v1/invite-codes/:id/revoke',
    requirePermission({ athlete: ['create'] }),
    async (c) => c.json(toResponse(await service.revoke(c.req.param('id')), service)),
  );

  return routes;
}

/** El `status` es derivado, no un campo: se resuelve al responder. */
function toResponse(code: InviteCodeDoc, service: InviteCodeService) {
  return {
    publicId: String(code['publicId']),
    code: code.code,
    venueId: code.venueId,
    maxUses: code.maxUses,
    usedCount: code.usedCount,
    expiresAt: fromBsonDate(code.expiresAt).toString(),
    revokedAt: code.revokedAt ? fromBsonDate(code.revokedAt).toString() : null,
    status: service.statusOf(code),
    createdAt: code['createdAt'] instanceof Date ? fromBsonDate(code['createdAt']).toString() : '',
  };
}
