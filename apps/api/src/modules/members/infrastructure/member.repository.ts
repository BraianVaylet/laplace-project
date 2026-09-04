import type { FilterQuery } from 'mongoose';
import { TenantRepository } from '../../../tenancy/repository.js';
import { MemberModel, type MemberDoc } from './member.model.js';

/**
 * Acceso a datos de Member. Hereda la inyeccion de `tenantId`, el soft delete y
 * la paginacion por cursor del repositorio base (ADR-000).
 */
export class MemberRepository extends TenantRepository<MemberDoc> {
  constructor() {
    super(MemberModel, 'member');
  }

  /** Varios socios por su `publicId`, en una sola consulta. */
  async byPublicIds(publicIds: readonly string[]): Promise<MemberDoc[]> {
    if (publicIds.length === 0) return [];

    return this.list({ publicId: { $in: publicIds } } as never, { limit: publicIds.length }).then(
      (page) => page.items,
    );
  }

  /**
   * Cuenta los que consumen cupo del plan: todos menos los archivados (§2.2.1).
   * Archivar a los que se fueron no debe costar plata.
   */
  async countActive(): Promise<number> {
    return this.count({ status: { $ne: 'archived' } } as FilterQuery<MemberDoc>);
  }

  /**
   * Socios activos de una sede. `active` de verdad, no "todo lo que no esta
   * archivado": es el denominador de las asistencias por socio y de la
   * morosidad (§2.1.12), y meter ahi a los `lead` y a los `inactive` haria que
   * los dos KPI mientan hacia abajo.
   */
  async countActiveIn(venueId: string): Promise<number> {
    return this.count({ status: 'active', venueIds: venueId } as FilterQuery<MemberDoc>);
  }

  async findByDocId(docId: string): Promise<MemberDoc | null> {
    return this.findOne({ docId } as FilterQuery<MemberDoc>);
  }
}
