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

  /**
   * Cuantas sedes tienen horario cargado. Lo consulta el asistente de
   * onboarding: una sede sin horario no puede agendar nada.
   */
  async countWithBusinessHours(): Promise<number> {
    return this.count({
      status: 'active',
      'businessHours.0': { $exists: true },
    } as FilterQuery<VenueDoc>);
  }

  /**
   * 🔴 Todas las sedes activas de **todos los tenants**, para el job de
   * metricas.
   *
   * Un job no corre dentro del pedido de nadie: es el mismo uso legitimo de
   * `skipTenantScope` que documenta el plugin. Devuelve el `tenantId` para que
   * el servicio abra el contexto de cada centro antes de tocar nada.
   */
  async allAcrossTenants(limit = 2000): Promise<VenueDoc[]> {
    return VenueModel.find({ deletedAt: null, status: 'active' })
      .setOptions({ skipTenantScope: true })
      .limit(limit)
      .lean<VenueDoc[]>()
      .exec();
  }
}
