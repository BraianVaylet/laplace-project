import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import { runWithTenant } from '../../tenancy/context.js';
import { ProductService, type PurchaseHistory } from './application/product-service.js';
import type { ProductDoc } from './infrastructure/product.model.js';
import { ProductRepository } from './infrastructure/product.repository.js';
import { VICTIM_PRODUCT_NAME, createProductRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Products. Es lo unico que puede tocar otro modulo:
 * el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface ProductsModule {
  routes: ReturnType<typeof createProductRoutes>;
  service: ProductService;
}

export interface ProductsModuleDeps {
  entitlements: EntitlementsLoader;
  /** Lo contesta Contracts cuando exista (F1-08). */
  purchases?: PurchaseHistory | undefined;
}

export function createProductsModule(deps: ProductsModuleDeps): ProductsModule {
  const products = new ProductRepository();
  const service = new ProductService({
    products,
    ...(deps.purchases ? { purchases: deps.purchases } : {}),
  });

  /** Siembra un producto del tenant victima para la suite de aislamiento (F0-05). */
  const seedVictimProduct = async (victimTenantId: string) => {
    const created = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        products.create({
          name: VICTIM_PRODUCT_NAME,
          type: 'class_pack',
          priceCents: 6_000_000,
          currency: 'ARS',
          credits: 8,
          durationDays: 30,
          allowedCategories: [],
          allowedTimeRanges: [],
          venueIds: ['ven_victima'],
          visibleInApp: true,
          autoRenew: false,
          soldCount: 0,
          active: true,
        } as Partial<ProductDoc>),
    );

    return String(created['publicId']);
  };

  return { routes: createProductRoutes(service, deps.entitlements, seedVictimProduct), service };
}

export type { ProductService, PurchaseHistory } from './application/product-service.js';
