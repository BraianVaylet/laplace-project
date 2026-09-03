import { Temporal } from '@js-temporal/polyfill';
import type {
  AccountStatement,
  CreateChargeInput,
  RefundPaymentInput,
  RegisterPaymentInput,
  TillSummary,
} from '@laplace/schemas';
import type { AuditWriter } from '../../../audit/audit-log.js';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { requireTenant, runWithTenant } from '../../../tenancy/context.js';
import {
  allocatePayment,
  assertNoArrears,
  assertRefundable,
  balanceOf,
  billingStatusOf,
  overdueOf,
  summarizeTill,
  type PayableCharge,
} from '../domain/billing.js';
import type { ChargeDoc, PaymentDoc } from '../infrastructure/billing.model.js';
import type {
  ChargeRepository,
  PaymentRepository,
  RefundRepository,
} from '../infrastructure/billing.repository.js';

/**
 * El saldo cacheado del socio. Lo escribe Billing y lo lee la ficha 360 (F1-06).
 *
 * El estado de cuenta es la **fuente de verdad** y se calcula sobre cargos y
 * pagos; esto es una copia para no tener que recalcularlo cada vez que se abre
 * una lista de socios.
 */
export interface MemberBalanceCache {
  set(memberId: string, balanceCents: number): Promise<void>;
}

export interface BillingServiceDeps {
  charges: ChargeRepository;
  payments: PaymentRepository;
  refunds: RefundRepository;
  events: DomainEventBus;
  audit: AuditWriter;
  members: MemberBalanceCache;
  now?: (() => Temporal.Instant) | undefined;
}

export class BillingService {
  private readonly charges: ChargeRepository;
  private readonly payments: PaymentRepository;
  private readonly refunds: RefundRepository;
  private readonly events: DomainEventBus;
  private readonly audit: AuditWriter;
  private readonly members: MemberBalanceCache;
  private readonly now: () => Temporal.Instant;

  constructor(deps: BillingServiceDeps) {
    this.charges = deps.charges;
    this.payments = deps.payments;
    this.refunds = deps.refunds;
    this.events = deps.events;
    this.audit = deps.audit;
    this.members = deps.members;
    this.now = deps.now ?? (() => Temporal.Now.instant());
  }

  /** Genera un cargo. Sin vencimiento declarado, vence hoy. */
  async createCharge(input: CreateChargeInput): Promise<ChargeDoc> {
    const dueAt = input.dueAt === undefined ? this.now() : Temporal.Instant.from(input.dueAt);

    const charge = await this.charges.create({
      ...input,
      paidCents: 0,
      dueAt: toBsonDate(dueAt),
      status: 'pending',
    } as Partial<ChargeDoc>);

    await this.refreshBalance(input.memberId);

    return charge;
  }

  /**
   * 🔴 Registra un pago. **Idempotente por `Idempotency-Key`** (§5.0): el
   * reintento de un pago que falló por timeout no puede cobrar dos veces.
   *
   * La garantía real es el índice único `{ tenantId, idempotencyKey }`; el
   * chequeo previo existe para poder devolver el pago original en el error, que
   * es lo que el mostrador necesita para no volver a cobrarlo a mano.
   */
  async registerPayment(input: RegisterPaymentInput, idempotencyKey: string): Promise<PaymentDoc> {
    const previo = await this.payments.findByIdempotencyKey(idempotencyKey);
    if (previo) throw duplicatePayment(previo);

    const { userId } = requireTenant();
    const now = this.now();

    let payment: PaymentDoc;
    try {
      payment = await this.payments.create({
        memberId: input.memberId,
        venueId: input.venueId,
        chargeIds: [],
        amountCents: input.amountCents,
        refundedCents: 0,
        currency: input.currency,
        method: input.method,
        // Un pago manual ya ocurrió: el efectivo está en la caja.
        status: 'approved',
        ...(input.receipt === undefined ? {} : { receipt: input.receipt }),
        ...(input.note === undefined ? {} : { note: input.note }),
        receivedAt: toBsonDate(now),
        receivedBy: userId,
        idempotencyKey,
      } as Partial<PaymentDoc>);
    } catch (error) {
      // Perdió la carrera contra el índice: el otro pedido ya lo registró.
      if (!isDuplicateKey(error)) throw error;

      const ganador = await this.payments.findByIdempotencyKey(idempotencyKey);
      throw ganador ? duplicatePayment(ganador) : (error as Error);
    }

    const paymentId = String(payment['publicId']);
    const imputados = await this.applyToCharges(input);
    await this.refreshBalance(input.memberId);

    await this.events.emit('payment.received', {
      paymentId,
      memberId: input.memberId,
      amountCents: input.amountCents,
    });

    const conImputacion = await this.payments.updateByPublicId(paymentId, {
      $set: { chargeIds: imputados },
    });

    return conImputacion ?? payment;
  }

  /**
   * Anula un pago con un reembolso. **Nunca se borra** (§5.2.4): si el pago
   * desapareciera, el arqueo del día anterior dejaría de coincidir y nadie
   * sabría por qué.
   */
  async refundPayment(paymentId: string, input: RefundPaymentInput): Promise<PaymentDoc> {
    const payment = await this.payments.findByPublicId(paymentId);
    if (!payment) throw notFound(paymentId);

    const disponible = payment.amountCents - payment.refundedCents;
    const cents = input.amountCents ?? disponible;

    assertRefundable(
      {
        publicId: paymentId,
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        status: payment.status,
      },
      cents,
    );

    await this.refunds.create({ paymentId, amountCents: cents, reason: input.reason });

    const updated = await this.payments.addRefund(
      paymentId,
      cents,
      payment.refundedCents + cents >= payment.amountCents,
    );
    if (!updated) throw notFound(paymentId);

    /*
     * Los cargos que este pago había saldado vuelven a deber. Se descuenta lo
     * reembolsado del `paidCents` de cada uno, del más nuevo al más viejo: la
     * deuda que reaparece es la última que se saldó.
     */
    let restante = cents;
    for (const chargeId of [...payment.chargeIds].reverse()) {
      if (restante === 0) break;
      const charge = await this.charges.findByPublicId(chargeId);
      if (!charge) continue;

      const quita = Math.min(restante, charge.paidCents);
      await this.charges.updateByPublicId(chargeId, {
        $inc: { paidCents: -quita },
        /*
         * Vuelve a deber, siempre: la imputacion nunca sobrepaga un cargo — lo
         * que sobra queda como saldo a favor del socio —, asi que sacarle algo
         * lo deja por debajo de su importe.
         */
        $set: { status: 'pending' },
      } as never);
      restante -= quita;
    }

    await this.refreshBalance(payment.memberId);

    await this.audit.record({
      action: 'payment.refunded',
      targetType: 'payment',
      targetId: paymentId,
      reason: input.reason,
      before: { refundedCents: payment.refundedCents },
      after: { refundedCents: payment.refundedCents + cents },
    });

    return updated;
  }

  /**
   * El estado de cuenta del socio: qué se le cobró, qué pagó, cuánto debe y
   * cuánto de eso está vencido. Es la **fuente de verdad** del saldo.
   */
  async statement(memberId: string): Promise<AccountStatement> {
    const [charges, payments] = await Promise.all([
      this.charges.ofMember(memberId),
      this.payments.ofMember(memberId),
    ]);

    const nowIso = this.now().toString();

    const balanceCents = balanceOf(
      charges.map((charge) => ({
        amountCents: charge.amountCents,
        status: charge.status as never,
      })),
      payments.map((payment) => ({
        amountCents: payment.amountCents,
        refundedCents: payment.refundedCents,
        status: payment.status,
      })),
    );
    const overdueCents = overdueOf(charges.map(toPayable), nowIso);

    return {
      memberId,
      currency: (charges[0]?.currency ?? payments[0]?.currency ?? 'ARS') as 'ARS',
      balanceCents,
      overdueCents,
      status: billingStatusOf(balanceCents, overdueCents),
      charges: charges.map(chargeToResponse),
      payments: payments.map(paymentToResponse),
    };
  }

  /**
   * 🔴 El corte de la mora sobre una accion del socio (§2.1.12). Lo llama
   * Booking (F1-14) antes de reservar.
   *
   * `allowDebt` sale de la politica del Venue y su default es `false`
   * (ADR-004): el centro decide si deja reservar a quien debe. La morosidad es
   * el KPI numero 1 del mercado argentino, y la palanca que la mueve es esta.
   */
  async assertCanTransact(memberId: string, allowDebt: boolean): Promise<void> {
    const { overdueCents } = await this.statement(memberId);

    assertNoArrears(overdueCents, allowDebt);
  }

  /**
   * Job diario de mora: pasa a `overdue` los cargos vencidos e impagos, marca
   * al socio como deudor y avisa.
   *
   * **Idempotente**: el filtro solo trae los que siguen `pending`, asi que la
   * segunda corrida del dia no encuentra nada.
   */
  async runDunning(): Promise<number> {
    const now = this.now();
    const vencidos = await this.charges.overdueAcrossTenants(toBsonDate(now));
    let marcados = 0;

    for (const charge of vencidos) {
      const tenantId = String(charge['tenantId']);
      const chargeId = String(charge['publicId']);

      await runWithTenant(
        { tenantId, userId: 'system:dunning', requestId: `job-dunning-${chargeId}` },
        async () => {
          await this.charges.updateByPublicId(chargeId, { $set: { status: 'overdue' } });

          // Refrescar el saldo tambien prende el flag `debtor` del socio.
          const { overdueCents, balanceCents } = await this.statement(charge.memberId);
          await this.members.set(charge.memberId, balanceCents);

          await this.events.emit('charge.overdue', {
            chargeId,
            memberId: charge.memberId,
            overdueCents,
          });
        },
      );

      marcados += 1;
    }

    return marcados;
  }

  /**
   * El arqueo de caja de una sede en un dia (§2.1.16).
   *
   * El dia es el **del centro**, en su zona horaria: si se calculara en UTC, la
   * caja de un centro argentino cerraria a las 21:00 y los pagos de la ultima
   * hora entrarian en el dia siguiente.
   */
  /**
   * Que dia es hoy **en el centro**. Lo resuelve el servicio y no la ruta
   * porque el reloj es inyectable aca: leerlo en la ruta haria que la caja de
   * hoy fuera lo unico del modulo que no se puede testear con un reloj fijo.
   */
  todayIn(timeZone: string): string {
    return this.now().toZonedDateTimeISO(timeZone).toPlainDate().toString();
  }

  async till(venueId: string, date: string, timeZone: string): Promise<TillSummary> {
    const desde = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone });
    const hasta = desde.add({ days: 1 });

    const payments = await this.payments.ofVenueBetween(
      venueId,
      toBsonDate(desde.toInstant()),
      toBsonDate(hasta.toInstant()),
    );

    return {
      venueId,
      date,
      currency: (payments[0]?.currency ?? 'ARS') as 'ARS',
      ...summarizeTill(
        payments.map((payment) => ({
          method: payment.method as never,
          amountCents: payment.amountCents,
          refundedCents: payment.refundedCents,
          status: payment.status,
        })),
      ),
    };
  }

  /** Anula un cargo. Tampoco se borra: queda en `void` y deja de contar. */
  /**
   * El cargo y el pago, como los necesita un aviso: de que sede son y de que
   * fecha. Son los puertos que consume Notifications (F1-22), y devuelven
   * `null` en vez de tirar: un aviso que no encuentra su cargo no sale, no
   * rompe el job.
   */
  async chargeContextOf(
    chargeId: string,
  ): Promise<{ venueId: string; dueAt: Temporal.Instant } | null> {
    const charge = await this.charges.findByPublicId(chargeId);

    return charge ? { venueId: charge.venueId, dueAt: fromBsonDate(charge.dueAt) } : null;
  }

  async paymentContextOf(
    paymentId: string,
  ): Promise<{ venueId: string; receivedAt: Temporal.Instant } | null> {
    const payment = await this.payments.findByPublicId(paymentId);

    return payment
      ? { venueId: payment.venueId, receivedAt: fromBsonDate(payment.receivedAt) }
      : null;
  }

  async voidCharge(chargeId: string, reason: string): Promise<ChargeDoc> {
    const charge = await this.charges.findByPublicId(chargeId);
    if (!charge) throw notFound(chargeId);

    const updated = await this.charges.updateByPublicId(chargeId, { $set: { status: 'void' } });
    if (!updated) throw notFound(chargeId);

    await this.refreshBalance(charge.memberId);
    await this.audit.record({
      action: 'charge.voided',
      targetType: 'charge',
      targetId: chargeId,
      reason,
      before: { status: charge.status },
      after: { status: 'void' },
    });

    return updated;
  }

  /** Imputa el pago a los cargos que corresponda y devuelve cuáles tocó. */
  private async applyToCharges(input: RegisterPaymentInput): Promise<string[]> {
    const todos = await this.charges.ofMember(input.memberId);
    const elegibles =
      input.chargeIds.length === 0
        ? todos
        : todos.filter((charge) => input.chargeIds.includes(String(charge['publicId'])));

    const { allocations } = allocatePayment(input.amountCents, elegibles.map(toPayable));

    for (const allocation of allocations) {
      await this.charges.applyPayment(allocation.chargeId, allocation.cents);
    }

    return allocations.map((allocation) => allocation.chargeId);
  }

  /** Refresca el saldo cacheado del socio. El estado de cuenta sigue siendo la verdad. */
  private async refreshBalance(memberId: string): Promise<number> {
    const { balanceCents } = await this.statement(memberId);
    await this.members.set(memberId, balanceCents);

    return balanceCents;
  }
}

const toPayable = (charge: ChargeDoc): PayableCharge => ({
  publicId: String(charge['publicId']),
  amountCents: charge.amountCents,
  paidCents: charge.paidCents,
  dueAt: fromBsonDate(charge.dueAt).toString(),
  status: charge.status as never,
});

function chargeToResponse(charge: ChargeDoc): AccountStatement['charges'][number] {
  return {
    publicId: String(charge['publicId']),
    memberId: charge.memberId,
    venueId: charge.venueId,
    ...(charge.contractId === undefined ? {} : { contractId: charge.contractId }),
    amountCents: charge.amountCents,
    paidCents: charge.paidCents,
    currency: charge.currency as 'ARS',
    dueAt: fromBsonDate(charge.dueAt).toString(),
    status: charge.status as never,
    description: charge.description,
    createdAt: isoOf(charge['createdAt']),
  };
}

function paymentToResponse(payment: PaymentDoc): AccountStatement['payments'][number] {
  return {
    publicId: String(payment['publicId']),
    memberId: payment.memberId,
    venueId: payment.venueId,
    chargeIds: payment.chargeIds,
    amountCents: payment.amountCents,
    refundedCents: payment.refundedCents,
    currency: payment.currency as 'ARS',
    method: payment.method as never,
    status: payment.status as never,
    ...(payment.receipt === undefined ? {} : { receipt: payment.receipt }),
    ...(payment.note === undefined ? {} : { note: payment.note }),
    receivedAt: fromBsonDate(payment.receivedAt).toString(),
    receivedBy: payment.receivedBy,
    createdAt: isoOf(payment['createdAt']),
  };
}

const isoOf = (value: unknown): string =>
  value instanceof Date ? fromBsonDate(value).toString() : '';

function notFound(id: string): AppError {
  return new AppError({
    code: 'LP-BILL-404-004',
    status: 404,
    message: 'No encontramos ese movimiento.',
    meta: { id },
  });
}

/**
 * El mismo pago dos veces. El error lleva el pago original: sin él, el mostrador
 * no puede confirmar que el cobro entró y termina cobrando de nuevo a mano.
 */
function duplicatePayment(existing: PaymentDoc): AppError {
  return new AppError({
    code: 'LP-BILL-409-002',
    status: 409,
    message: 'Este pago ya fue registrado.',
    action: 'Buscalo en el estado de cuenta del socio.',
    meta: {
      paymentId: String(existing['publicId']),
      amountCents: existing.amountCents,
      receivedAt: fromBsonDate(existing.receivedAt).toString(),
    },
  });
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}
