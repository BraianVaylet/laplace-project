import type { FilterQuery } from 'mongoose';
import { TenantRepository } from '../../../tenancy/repository.js';
import {
  ChargeModel,
  PaymentModel,
  RefundModel,
  type ChargeDoc,
  type PaymentDoc,
  type RefundDoc,
} from './billing.model.js';

/** Cargos del centro a sus socios. */
export class ChargeRepository extends TenantRepository<ChargeDoc> {
  constructor() {
    super(ChargeModel, 'charge');
  }

  /** Todos los cargos de un socio, del mas viejo al mas nuevo. */
  async ofMember(memberId: string): Promise<ChargeDoc[]> {
    return ChargeModel.find(this.scope({ memberId } as FilterQuery<ChargeDoc>))
      .sort({ dueAt: 1 })
      .lean<ChargeDoc[]>()
      .exec();
  }

  /**
   * Imputa dinero a un cargo de forma **atomica**, y lo salda si con eso
   * alcanza. El `$inc` y el chequeo suceden en la misma operacion: con dos
   * pagos simultaneos sobre el mismo cargo, un `read` y despues un `write`
   * perderia uno de los dos.
   */
  async applyPayment(publicId: string, cents: number): Promise<ChargeDoc | null> {
    const updated = await this.updateByPublicId(publicId, { $inc: { paidCents: cents } } as never);
    if (!updated) return null;

    if (updated.paidCents >= updated.amountCents && updated.status !== 'paid') {
      return this.updateByPublicId(publicId, { $set: { status: 'paid' } });
    }

    return updated;
  }
}

/** Pagos de los socios al centro. */
export class PaymentRepository extends TenantRepository<PaymentDoc> {
  constructor() {
    super(PaymentModel, 'payment');
  }

  async ofMember(memberId: string): Promise<PaymentDoc[]> {
    return PaymentModel.find(this.scope({ memberId } as FilterQuery<PaymentDoc>))
      .sort({ receivedAt: 1 })
      .lean<PaymentDoc[]>()
      .exec();
  }

  /** El pago ya registrado con esa clave, si existe. Lo usa la idempotencia. */
  async findByIdempotencyKey(key: string): Promise<PaymentDoc | null> {
    return this.findOne({ idempotencyKey: key } as FilterQuery<PaymentDoc>);
  }

  /** Suma un reembolso al pago sin borrarlo nunca (§5.2.4). */
  async addRefund(
    publicId: string,
    cents: number,
    fullyRefunded: boolean,
  ): Promise<PaymentDoc | null> {
    return this.updateByPublicId(publicId, {
      $inc: { refundedCents: cents },
      ...(fullyRefunded ? { $set: { status: 'refunded' } } : {}),
    } as never);
  }
}

/** Reembolsos. Un pago nunca se borra: se anula con uno de estos (§5.2.4). */
export class RefundRepository extends TenantRepository<RefundDoc> {
  constructor() {
    super(RefundModel, 'refund');
  }

  async ofPayment(paymentId: string): Promise<RefundDoc[]> {
    return RefundModel.find(this.scope({ paymentId } as FilterQuery<RefundDoc>))
      .lean<RefundDoc[]>()
      .exec();
  }
}
