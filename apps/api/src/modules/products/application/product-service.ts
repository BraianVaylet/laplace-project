import type { CreateProductInput, ProductType, UpdateProductInput } from '@laplace/schemas';
import { createProductSchema } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import type { Page } from '../../../tenancy/repository.js';
import { assertSellable, assertTrialAvailable } from '../domain/product.js';
import type { ProductDoc } from '../infrastructure/product.model.js';
import type { ProductRepository } from '../infrastructure/product.repository.js';

/**
 * ¿Esta persona ya usó su clase de prueba? Lo contesta Contracts (F1-08), que es
 * quien conoce el historial de compras.
 *
 * Hasta que exista, el default responde `false`: hoy no hay contratos en la
 * base, así que nadie usó nada. El día que Contracts entre, se cambia una línea
 * en el punto de composición y la regla empieza a aplicar sin tocar este módulo.
 */
export interface PurchaseHistory {
  hasUsedTrial(memberId: string): Promise<boolean>;
}

export const NO_PURCHASES_YET: PurchaseHistory = {
  hasUsedTrial: () => Promise.resolve(false),
};

export interface ProductFilters {
  type?: ProductType | undefined;
  venueId?: string | undefined;
  active?: boolean | undefined;
  /** Fuerza el catálogo público. Lo usa la WAFM y quien no sea staff. */
  onlyVisible?: boolean | undefined;
}

export interface ProductServiceDeps {
  products: ProductRepository;
  purchases?: PurchaseHistory | undefined;
}

/**
 * Casos de uso de Product. Orquesta el repositorio; no sabe de HTTP ni de
 * Mongoose.
 */
export class ProductService {
  private readonly products: ProductRepository;
  private readonly purchases: PurchaseHistory;

  constructor(deps: ProductServiceDeps) {
    this.products = deps.products;
    this.purchases = deps.purchases ?? NO_PURCHASES_YET;
  }

  async create(input: CreateProductInput): Promise<ProductDoc> {
    return this.products.create({ ...input, soldCount: 0, active: true } as Partial<ProductDoc>);
  }

  async list(filters: ProductFilters, cursor?: string, limit?: number): Promise<Page<ProductDoc>> {
    const filter: Record<string, unknown> = {};
    if (filters.type !== undefined) filter['type'] = filters.type;
    if (filters.venueId !== undefined) filter['venueIds'] = filters.venueId;
    if (filters.active !== undefined) filter['active'] = filters.active;

    // El catálogo público no muestra lo oculto ni lo archivado. Se fuerza en el
    // servidor: ocultar un producto en el front no es una restricción.
    if (filters.onlyVisible === true) {
      filter['visibleInApp'] = true;
      filter['active'] = true;
    }

    return this.products.list(filter, {
      sortField: 'createdAt',
      direction: 'desc',
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  async getByPublicId(id: string): Promise<ProductDoc> {
    const product = await this.products.findByPublicId(id);
    if (!product) throw notFound(id);

    return product;
  }

  /**
   * Edita. El tipo no se toca (lo bloquea el schema), y el precio nuevo **no**
   * altera los contratos ya vendidos: cada uno guarda su `priceSnapshotCents`
   * al comprarse (F1-08).
   */
  async update(id: string, input: UpdateProductInput): Promise<ProductDoc> {
    const current = await this.getByPublicId(id);

    /*
     * Las reglas por tipo se revalidan con el documento ya mezclado: un PATCH
     * que borra `credits` de un pack lo dejaría vendible y sin clases, y el
     * schema del PATCH por sí solo no puede verlo porque no conoce el tipo.
     */
    const merged = { ...current, ...input, type: current.type };
    const check = createProductSchema.safeParse(merged);
    if (!check.success) {
      const detail = check.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(' · ');

      throw new AppError({
        code: 'LP-PROD-422-001',
        status: 422,
        message: `Revisá la configuración del producto: ${detail}`,
        meta: { issues: check.error.issues },
      });
    }

    const updated = await this.products.updateByPublicId(id, { $set: { ...input } });
    if (!updated) throw notFound(id);

    return updated;
  }

  /**
   * Archivar deja de vender, pero **no toca los contratos vivos**: quien compró
   * el pack la semana pasada sigue teniendo sus clases (§2.1.17).
   */
  async setActive(id: string, active: boolean): Promise<ProductDoc> {
    await this.getByPublicId(id);

    const updated = await this.products.updateByPublicId(id, { $set: { active } });
    if (!updated) throw notFound(id);

    return updated;
  }

  /**
   * Suma una venta. Es lo que hace que el cupo `maxSales` aplique de verdad, y
   * lo llama Contracts al vender.
   */
  async registerSale(productId: string): Promise<void> {
    await this.products.updateByPublicId(productId, { $inc: { soldCount: 1 } } as never);
  }

  /** Devuelve una venta anotada. Compensa una venta que falló después del `$inc`. */
  async releaseSale(productId: string): Promise<void> {
    await this.products.updateByPublicId(productId, { $inc: { soldCount: -1 } } as never);
  }

  /**
   * Todo lo que hay que verificar antes de vender. Lo llama Contracts (F1-08)
   * desde la operación de compra.
   */
  async assertPurchasable(productId: string, memberId: string): Promise<ProductDoc> {
    const product = await this.getByPublicId(productId);

    assertSellable({
      publicId: String(product['publicId']),
      name: product.name,
      type: product.type as ProductType,
      priceCents: product.priceCents,
      maxSales: product.maxSales,
      soldCount: product.soldCount,
      active: product.active,
    });

    assertTrialAvailable(product.type as ProductType, await this.purchases.hasUsedTrial(memberId));

    return product;
  }
}

function notFound(productId: string): AppError {
  return new AppError({
    code: 'LP-PROD-404-003',
    status: 404,
    message: 'No encontramos ese producto.',
    meta: { productId },
  });
}
