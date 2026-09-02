import { TenantRepository } from '../../../tenancy/repository.js';
import { ProductModel, type ProductDoc } from './product.model.js';

/**
 * Acceso a datos de Product. Hereda la inyeccion de `tenantId`, el soft delete y
 * la paginacion por cursor del repositorio base (ADR-000).
 */
export class ProductRepository extends TenantRepository<ProductDoc> {
  constructor() {
    super(ProductModel, 'product');
  }
}
