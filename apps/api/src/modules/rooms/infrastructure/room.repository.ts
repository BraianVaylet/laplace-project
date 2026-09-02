import type { FilterQuery } from 'mongoose';
import { TenantRepository } from '../../../tenancy/repository.js';
import { RoomModel, type RoomDoc } from './room.model.js';

/**
 * Acceso a datos de Room. Hereda la inyeccion de `tenantId`, el soft delete y
 * la paginacion por cursor del repositorio base (ADR-000).
 */
export class RoomRepository extends TenantRepository<RoomDoc> {
  constructor() {
    super(RoomModel, 'room');
  }

  /** ¿Ya tiene salas esta sede? Lo usa el alta automatica para no duplicar. */
  async countByVenue(venueId: string): Promise<number> {
    return this.count({ venueId } as FilterQuery<RoomDoc>);
  }
}
