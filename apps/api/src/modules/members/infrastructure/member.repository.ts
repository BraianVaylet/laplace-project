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
