import { Hono } from 'hono';
import { z } from 'zod';
import {
  createProductSchema,
  paginatedSchema,
  paginationQuerySchema,
  productSchema,
  productTypeSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { authorize } from '../../../auth/permissions.js';
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
import type { ProductService } from '../application/product-service.js';

const idParams = z.object({ id: z.string() });
const listQuery = paginationQuerySchema.extend({
  type: productTypeSchema.optional(),
  venueId: z.string().optional(),
  active: z.enum(['true', 'false']).optional(),
});

/** Nombre del producto sembrado por los fixtures. Ninguna respuesta al atacante puede contenerlo. */
export const VICTIM_PRODUCT_NAME = 'Pack del otro centro';

export function createProductRoutes(
  service: ProductService,
  entitlements: EntitlementsLoader,
  /** Siembra un producto del tenant víctima. La arma el módulo, que tiene el repositorio. */
  seedVictimProduct: (victimTenantId: string) => Promise<string>,
) {
  const attackProduct: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/products/${await seedVictimProduct(victimTenantId)}`,
  });

  const subPath =
    (suffix: string): IsolationFixture =>
    async (context) => ({ path: `${(await attackProduct(context)).path}${suffix}` });

  const seedAndList: IsolationFixture = async ({ victimTenantId }) => {
    await seedVictimProduct(victimTenantId);
    return { path: '/api/v1/products' };
  };

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/products',
      tenantScoped: true,
      isolationFixture: seedAndList,
      summary: 'Catálogo del centro',
      tags: ['products'],
      permission: { product: ['read'] },
      request: { query: listQuery },
      response: { status: 200, schema: paginatedSchema(productSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/products',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/products',
          body: { name: 'Sonda', type: 'event', priceCents: 0, venueIds: ['ven_x'] },
        }),
      summary: 'Publicar un producto',
      tags: ['products'],
      permission: { product: ['create'] },
      request: { body: createProductSchema },
      response: { status: 201, schema: productSchema },
      errorCodes: ['LP-PROD-422-001', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/products/:id',
      tenantScoped: true,
      isolationFixture: attackProduct,
      summary: 'Ver un producto',
      tags: ['products'],
      permission: { product: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: productSchema },
      errorCodes: ['LP-PROD-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/products/:id',
      tenantScoped: true,
      isolationFixture: attackProduct,
      summary: 'Editar un producto',
      tags: ['products'],
      permission: { product: ['update'] },
      request: { params: idParams, body: updateProductSchema },
      response: { status: 200, schema: productSchema },
      errorCodes: ['LP-PROD-404-003', 'LP-PROD-422-001', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/products/:id/archive',
      tenantScoped: true,
      isolationFixture: subPath('/archive'),
      summary: 'Archivar un producto',
      tags: ['products'],
      permission: { product: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: productSchema },
      errorCodes: ['LP-PROD-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/products/:id/restore',
      tenantScoped: true,
      isolationFixture: subPath('/restore'),
      summary: 'Volver a publicar un producto archivado',
      tags: ['products'],
      permission: { product: ['archive'] },
      request: { params: idParams },
      response: { status: 200, schema: productSchema },
      errorCodes: ['LP-PROD-404-003', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('products'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/products', guard);
    routes.use('/api/v1/products/*', guard);
  }

  routes.get('/api/v1/products', requirePermission({ product: ['read'] }), async (c) => {
    const query = listQuery.parse(c.req.query());

    /*
     * El socio ve el catálogo público; el staff ve todo. Se decide por el
     * permiso de creación y no por el nombre del rol: un rol nuevo que pueda
     * publicar productos hereda la vista completa sin tocar esto.
     */
    const isStaff = authorize(c.get('org').roles, { product: ['create'] });

    const page = await service.list(
      {
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.venueId === undefined ? {} : { venueId: query.venueId }),
        ...(query.active === undefined ? {} : { active: query.active === 'true' }),
        onlyVisible: !isStaff,
      },
      query.cursor,
      query.limit,
    );

    return c.json(page);
  });

  routes.post(
    '/api/v1/products',
    requirePermission({ product: ['create'] }),
    validated<CreateProductInput, AppEnv>(createProductSchema, async (c, input) =>
      c.json(await service.create(input), 201),
    ),
  );

  routes.get('/api/v1/products/:id', requirePermission({ product: ['read'] }), async (c) =>
    c.json(await service.getByPublicId(c.req.param('id'))),
  );

  routes.patch(
    '/api/v1/products/:id',
    requirePermission({ product: ['update'] }),
    validated<UpdateProductInput, AppEnv>(updateProductSchema, async (c, input) =>
      c.json(await service.update(c.req.param('id') as string, input)),
    ),
  );

  routes.post('/api/v1/products/:id/archive', requirePermission({ product: ['archive'] }), (c) =>
    service.setActive(c.req.param('id'), false).then((product) => c.json(product)),
  );

  routes.post('/api/v1/products/:id/restore', requirePermission({ product: ['archive'] }), (c) =>
    service.setActive(c.req.param('id'), true).then((product) => c.json(product)),
  );

  return routes;
}
