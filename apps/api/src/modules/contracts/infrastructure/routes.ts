import { Hono } from 'hono';
import { z } from 'zod';
import {
  adjustCreditsSchema,
  contractSchema,
  contractStatusSchema,
  freezeContractSchema,
  paginatedSchema,
  paginationQuerySchema,
  sellContractSchema,
  type AdjustCreditsInput,
  type FreezeContractInput,
  type SellContractInput,
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
import type { ContractService } from '../application/contract-service.js';

const idParams = z.object({ id: z.string() });
const listQuery = paginationQuerySchema.extend({
  memberId: z.string().optional(),
  status: contractStatusSchema.optional(),
});

/** Producto sembrado por los fixtures. Ninguna respuesta al atacante puede contenerlo. */
export const VICTIM_CONTRACT_PRODUCT = 'Pack del otro centro';

export function createContractRoutes(
  service: ContractService,
  entitlements: EntitlementsLoader,
  seedVictimContract: (victimTenantId: string) => Promise<string>,
) {
  const attackContract: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/contracts/${await seedVictimContract(victimTenantId)}`,
  });

  const subPath =
    (suffix: string): IsolationFixture =>
    async (context) => ({ path: `${(await attackContract(context)).path}${suffix}` });

  const seedAndList: IsolationFixture = async ({ victimTenantId }) => {
    await seedVictimContract(victimTenantId);
    return { path: '/api/v1/contracts' };
  };

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/contracts',
      tenantScoped: true,
      isolationFixture: seedAndList,
      summary: 'Contratos del centro',
      tags: ['contracts'],
      permission: { contract: ['read'] },
      request: { query: listQuery },
      response: { status: 200, schema: paginatedSchema(contractSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/contracts',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/contracts',
          body: { memberId: 'mem_x', productId: 'prd_x', venueId: 'ven_x' },
        }),
      summary: 'Vender un producto a un socio',
      tags: ['contracts'],
      permission: { contract: ['create'] },
      request: { body: sellContractSchema },
      response: { status: 201, schema: contractSchema },
      errorCodes: [
        'LP-PROD-404-003',
        'LP-PROD-409-002',
        'LP-PROD-422-001',
        'LP-SYS-422-006',
        'LP-AUTH-403-002',
      ],
    },
    {
      method: 'GET',
      path: '/api/v1/contracts/:id',
      tenantScoped: true,
      isolationFixture: attackContract,
      summary: 'Ver un contrato',
      tags: ['contracts'],
      permission: { contract: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: contractSchema },
      errorCodes: ['LP-CTRT-404-005', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/contracts/:id/activate',
      tenantScoped: true,
      isolationFixture: subPath('/activate'),
      summary: 'Activar un contrato cobrado',
      tags: ['contracts'],
      permission: { contract: ['create'] },
      request: { params: idParams },
      response: { status: 200, schema: contractSchema },
      errorCodes: ['LP-CTRT-404-005', 'LP-CTRT-422-004', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/contracts/:id/cancel',
      tenantScoped: true,
      isolationFixture: subPath('/cancel'),
      summary: 'Cancelar un contrato',
      tags: ['contracts'],
      // Cancelar da de baja algo cobrado: tiene su propio permiso, que el
      // mostrador no tiene.
      permission: { contract: ['cancel'] },
      request: { params: idParams },
      response: { status: 200, schema: contractSchema },
      errorCodes: ['LP-CTRT-404-005', 'LP-CTRT-422-004', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/contracts/:id/freeze',
      tenantScoped: true,
      isolationFixture: subPath('/freeze'),
      summary: 'Congelar un contrato por vacaciones o lesión',
      tags: ['contracts'],
      permission: { contract: ['freeze'] },
      request: { params: idParams, body: freezeContractSchema },
      response: { status: 200, schema: contractSchema },
      errorCodes: [
        'LP-CTRT-404-005',
        'LP-CTRT-422-004',
        'LP-CTRT-422-006',
        'LP-SYS-422-006',
        'LP-AUTH-403-002',
      ],
    },
    {
      method: 'POST',
      path: '/api/v1/contracts/:id/unfreeze',
      tenantScoped: true,
      isolationFixture: subPath('/unfreeze'),
      summary: 'Descongelar un contrato',
      tags: ['contracts'],
      permission: { contract: ['freeze'] },
      request: { params: idParams },
      response: { status: 200, schema: contractSchema },
      errorCodes: ['LP-CTRT-404-005', 'LP-CTRT-422-004', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/contracts/:id/credits',
      tenantScoped: true,
      isolationFixture: subPath('/credits'),
      summary: 'Ajustar los créditos a mano, con motivo',
      tags: ['contracts'],
      // Ajustar créditos es regalar o quitar plata: no es del mostrador.
      permission: { contract: ['adjust'] },
      request: { params: idParams, body: adjustCreditsSchema },
      response: { status: 200, schema: contractSchema },
      errorCodes: ['LP-CTRT-404-005', 'LP-CTRT-422-004', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('contracts'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/contracts', guard);
    routes.use('/api/v1/contracts/*', guard);
  }

  routes.get('/api/v1/contracts', requirePermission({ contract: ['read'] }), async (c) => {
    const query = listQuery.parse(c.req.query());

    return c.json(await service.list(query, query.cursor, query.limit));
  });

  routes.post(
    '/api/v1/contracts',
    requirePermission({ contract: ['create'] }),
    validated<SellContractInput, AppEnv>(sellContractSchema, async (c, input) =>
      c.json(await service.sell(input), 201),
    ),
  );

  routes.get('/api/v1/contracts/:id', requirePermission({ contract: ['read'] }), async (c) =>
    c.json(await service.getByPublicId(c.req.param('id'))),
  );

  routes.post('/api/v1/contracts/:id/activate', requirePermission({ contract: ['create'] }), (c) =>
    service.changeStatus(c.req.param('id'), 'active').then((contract) => c.json(contract)),
  );

  routes.post('/api/v1/contracts/:id/cancel', requirePermission({ contract: ['cancel'] }), (c) =>
    service.changeStatus(c.req.param('id'), 'cancelled').then((contract) => c.json(contract)),
  );

  routes.post(
    '/api/v1/contracts/:id/freeze',
    requirePermission({ contract: ['freeze'] }),
    validated<FreezeContractInput, AppEnv>(freezeContractSchema, async (c, input) =>
      c.json(await service.freeze(c.req.param('id') as string, input)),
    ),
  );

  routes.post('/api/v1/contracts/:id/unfreeze', requirePermission({ contract: ['freeze'] }), (c) =>
    service.unfreeze(c.req.param('id')).then((contract) => c.json(contract)),
  );

  routes.post(
    '/api/v1/contracts/:id/credits',
    requirePermission({ contract: ['adjust'] }),
    validated<AdjustCreditsInput, AppEnv>(adjustCreditsSchema, async (c, input) =>
      c.json(await service.adjustCredits(c.req.param('id') as string, input)),
    ),
  );

  return routes;
}
