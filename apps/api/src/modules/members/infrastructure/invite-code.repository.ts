import type { FilterQuery } from 'mongoose';
import { toBsonDate } from '../../../persistence/bson-date.js';
import type { Temporal } from '@js-temporal/polyfill';
import { TenantRepository } from '../../../tenancy/repository.js';
import { InviteCodeModel, type InviteCodeDoc } from './invite-code.model.js';

/**
 * Acceso a datos de InviteCode. Hereda la inyeccion de `tenantId` del
 * repositorio base para todo lo que hace el staff.
 *
 * El canje es la excepcion y esta abajo, documentada.
 */
export class InviteCodeRepository extends TenantRepository<InviteCodeDoc> {
  constructor() {
    super(InviteCodeModel, 'inviteCode');
  }

  /**
   * 🔴 **Consulta deliberadamente NO acotada por tenant.**
   *
   * El canje ocurre antes de que la persona pertenezca a ningun centro: el
   * `tenantId` sale del codigo, que es el unico dato que hay. Es la excepcion
   * que ADR-000 contempla, y se sostiene sobre el indice unico GLOBAL de
   * `code`: sin el, dos centros podrian tener el mismo codigo y esto devolveria
   * cualquiera de los dos.
   *
   * Consume un uso de forma **atomica**: el filtro exige que queden cupos y el
   * `$inc` sucede en la misma operacion, asi que dos canjes simultaneos del
   * ultimo lugar no pueden ganar los dos.
   */
  async consumeGlobally(code: string, now: Temporal.Instant): Promise<InviteCodeDoc | null> {
    return (
      InviteCodeModel.findOneAndUpdate(
        {
          code,
          deletedAt: null,
          revokedAt: null,
          expiresAt: { $gt: toBsonDate(now) },
          $expr: { $lt: ['$usedCount', '$maxUses'] },
        },
        { $inc: { usedCount: 1 } },
        { new: true },
      )
        // El plugin de tenant no puede filtrar acá: todavia no hay tenant.
        .setOptions({ skipTenantScope: true })
        .lean<InviteCodeDoc>()
        .exec()
    );
  }

  /** Devuelve el uso consumido. Compensa un canje que fallo despues del `$inc`. */
  async releaseGlobally(code: string): Promise<void> {
    await InviteCodeModel.updateOne({ code }, { $inc: { usedCount: -1 } })
      .setOptions({ skipTenantScope: true })
      .exec();
  }

  async findByCode(code: string): Promise<InviteCodeDoc | null> {
    return this.findOne({ code } as FilterQuery<InviteCodeDoc>);
  }
}
