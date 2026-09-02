import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { requireTenant } from '../../../tenancy/context.js';
import { TenantRepository } from '../../../tenancy/repository.js';
import { ContractModel, type ContractDoc } from './contract.model.js';

/**
 * Acceso a datos de Contract. Hereda la inyeccion de `tenantId` del repositorio
 * base (ADR-000).
 */
export class ContractRepository extends TenantRepository<ContractDoc> {
  constructor() {
    super(ContractModel, 'contract');
  }

  /** Los contratos vivos de un socio, para el selector de §2.1.9. */
  async activeOf(memberId: string): Promise<ContractDoc[]> {
    return ContractModel.find(
      this.scope({ memberId, status: 'active' } as FilterQuery<ContractDoc>),
    )
      .lean<ContractDoc[]>()
      .exec();
  }

  /** ¿Este socio ya compro una clase de prueba alguna vez? (§2.1.17) */
  async hasBought(memberId: string, productType: string): Promise<boolean> {
    // Incluye los cancelados y vencidos a proposito: la prueba es una sola vez
    // en la vida, no una por contrato vigente.
    const count = await ContractModel.countDocuments(
      this.scope({ memberId, productType } as FilterQuery<ContractDoc>),
    ).exec();

    return count > 0;
  }

  /**
   * 🔴 Consumo de un credito, **atomico** (§5.2.4).
   *
   * El filtro exige contrato activo, vigente y con creditos disponibles, y el
   * `$inc` sucede en la misma operacion. Con un `read` y despues un `write`, N
   * reservas simultaneas sobre el ultimo credito leerian el mismo `creditsUsed`
   * y pasarian todas: el socio termina con 9 clases usadas de un pack de 8.
   *
   * Devuelve `null` si no lo pudo tomar. Quien llama decide si intenta con el
   * contrato siguiente o corta.
   */
  async consumeCredit(publicId: string, now: Temporal.Instant): Promise<ContractDoc | null> {
    const { tenantId } = requireTenant();

    return ContractModel.findOneAndUpdate(
      {
        publicId,
        tenantId,
        deletedAt: null,
        status: 'active',
        $and: [
          { $or: [{ endsAt: null }, { endsAt: { $gt: toBsonDate(now) } }] },
          { $expr: { $lt: ['$creditsUsed', '$creditsTotal'] } },
        ],
      },
      { $inc: { creditsUsed: 1 } },
      { new: true },
    )
      .lean<ContractDoc>()
      .exec();
  }

  /**
   * Consumo de una membresia: no descuenta nada, pero verifica en la misma
   * consulta que siga activa y vigente. Sin esto, un contrato congelado entre
   * la lectura y la reserva dejaria entrar a alguien que ya no puede.
   */
  async touchMembership(publicId: string, now: Temporal.Instant): Promise<ContractDoc | null> {
    const { tenantId } = requireTenant();

    return ContractModel.findOne({
      publicId,
      tenantId,
      deletedAt: null,
      status: 'active',
      $or: [{ endsAt: null }, { endsAt: { $gt: toBsonDate(now) } }],
    })
      .lean<ContractDoc>()
      .exec();
  }

  /**
   * 🔴 Contratos vencidos de **todos los tenants**, para el job diario.
   *
   * Un job no corre dentro del pedido de nadie, asi que no hay tenant en el
   * contexto: es el segundo uso legitimo de `skipTenantScope`, y por eso
   * devuelve el `tenantId` — el servicio abre el contexto de cada centro antes
   * de tocar nada.
   */
  async dueToExpireAcrossTenants(now: Temporal.Instant, limit = 500): Promise<ContractDoc[]> {
    return ContractModel.find({
      deletedAt: null,
      status: { $in: ['active', 'frozen'] },
      endsAt: { $ne: null, $lte: toBsonDate(now) },
    })
      .setOptions({ skipTenantScope: true })
      .limit(limit)
      .lean<ContractDoc[]>()
      .exec();
  }

  /** Contratos activos que vencen dentro de la ventana de avisos, de todos los tenants. */
  async expiringSoonAcrossTenants(
    now: Temporal.Instant,
    withinDays: number,
    limit = 1000,
  ): Promise<ContractDoc[]> {
    return ContractModel.find({
      deletedAt: null,
      status: 'active',
      endsAt: {
        $ne: null,
        $gt: toBsonDate(now),
        $lte: toBsonDate(now.add({ hours: 24 * (withinDays + 1) })),
      },
    })
      .setOptions({ skipTenantScope: true })
      .limit(limit)
      .lean<ContractDoc[]>()
      .exec();
  }

  /** Devuelve un credito consumido. Lo usa la cancelacion en plazo (ADR-001). */
  async refundCredit(publicId: string): Promise<ContractDoc | null> {
    const { tenantId } = requireTenant();

    return ContractModel.findOneAndUpdate(
      // El `$gt: 0` evita que una doble devolucion deje creditos negativos.
      { publicId, tenantId, deletedAt: null, creditsUsed: { $gt: 0 } },
      { $inc: { creditsUsed: -1 } },
      { new: true },
    )
      .lean<ContractDoc>()
      .exec();
  }
}
