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

  async findByDocId(docId: string): Promise<MemberDoc | null> {
    return this.findOne({ docId } as FilterQuery<MemberDoc>);
  }
}
