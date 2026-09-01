import type { FilterQuery } from 'mongoose';
import { TenantRepository } from '../../../tenancy/repository.js';
import { VenueModel, type VenueDoc } from './venue.model.js';

/**
 * Acceso a datos de Venue. Hereda la inyeccion de `tenantId`, el soft delete y
 * la paginacion por cursor del repositorio base (ADR-000).
 */
export class VenueRepository extends TenantRepository<VenueDoc> {
  constructor() {
    super(VenueModel, 'venue');
  }

  /**
   * Cuenta las sedes **activas**. Es lo que consume el guard de entitlements:
   * archivar una sede que cerro tiene que liberar el cupo del plan (§2.2.1).
   */
  async countActive(): Promise<number> {
    return this.count({ status: 'active' } as FilterQuery<VenueDoc>);
  }
}
