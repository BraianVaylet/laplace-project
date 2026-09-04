import type { FilterQuery } from 'mongoose';
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

  /**
   * Cuantos productos vendibles tiene el centro. Lo consulta el asistente de
   * onboarding: uno archivado no sirve para arrancar.
   */
  async countActive(): Promise<number> {
    return this.count({ active: true } as FilterQuery<ProductDoc>);
  }
}
