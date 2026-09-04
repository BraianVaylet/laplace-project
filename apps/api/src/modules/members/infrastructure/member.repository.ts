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

  /**
   * Socios activos que no vienen desde antes de `since`. Es la alerta mas util
   * del panel (§2.1.12): las asistencias por semana son el mejor predictor
   * individual de baja.
   *
   * Los que nunca asistieron entran tambien (`lastAttendanceAt` sin valor): un
   * alta que nunca piso el centro es exactamente el caso que hay que llamar.
   */
  async inactiveSince(venueId: string, since: Date, limit = 50): Promise<MemberDoc[]> {
    return MemberModel.find(
      this.scope({
        venueIds: venueId,
        status: 'active',
        $or: [{ lastAttendanceAt: { $lt: since } }, { lastAttendanceAt: null }],
      } as FilterQuery<MemberDoc>),
    )
      .sort({ lastAttendanceAt: 1 })
      .limit(limit)
      .lean<MemberDoc[]>()
      .exec();
  }

  /** Los que deben plata, del que mas debe al que menos. */
  async debtorsIn(venueId: string, limit = 50): Promise<MemberDoc[]> {
    return MemberModel.find(
      this.scope({
        venueIds: venueId,
        balanceCents: { $lt: 0 },
      } as FilterQuery<MemberDoc>),
    )
      .sort({ balanceCents: 1 })
      .limit(limit)
      .lean<MemberDoc[]>()
      .exec();
  }

  /** Los socios activos de una sede, para chequear waivers en bloque. */
  async activeIn(venueId: string, limit = 500): Promise<MemberDoc[]> {
    return MemberModel.find(
      this.scope({ venueIds: venueId, status: 'active' } as FilterQuery<MemberDoc>),
    )
      .limit(limit)
      .lean<MemberDoc[]>()
      .exec();
  }

  /**
   * 🔴 Busqueda del buscador global del DFSM (F1-24): por nombre, apellido,
   * documento o telefono.
   *
   * El termino se **escapa** antes de armar la expresion regular: sin eso, un
   * socio que escribe `(` rompe la consulta con un error de sintaxis, y uno que
   * escribe `.*` se lleva la coleccion entera por delante.
   *
   * Ancla al principio de la palabra y no busca en el medio: es como piensa
   * quien busca ("empieza con Sos"), y ademas evita el escaneo mas caro.
   */
  async search(term: string, limit = 10): Promise<MemberDoc[]> {
    const patron = new RegExp(`\\b${escapeRegex(term)}`, 'i');

    return MemberModel.find(
      this.scope({
        $or: [{ firstName: patron }, { lastName: patron }, { docId: patron }, { phone: patron }],
      } as FilterQuery<MemberDoc>),
    )
      .sort({ lastName: 1, firstName: 1 })
      .limit(limit)
      .lean<MemberDoc[]>()
      .exec();
  }

  async findByDocId(docId: string): Promise<MemberDoc | null> {
    return this.findOne({ docId } as FilterQuery<MemberDoc>);
  }
}

/** Los metacaracteres de una expresion regular, neutralizados. */
function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
