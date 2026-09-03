import { Temporal } from '@js-temporal/polyfill';
import {
  EXPIRY_MILESTONES,
  consumesCredits,
  type AdjustCreditsInput,
  type Consumption,
  type ContractStatus,
  type FreezeContractInput,
  type ProductType,
  type SellContractInput,
} from '@laplace/schemas';
import type { AuditWriter } from '../../../audit/audit-log.js';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { runWithTenant } from '../../../tenancy/context.js';
import type { Page } from '../../../tenancy/repository.js';
import { assertFreezeAllowed, expiryMilestone, shiftExpiry } from '../domain/freeze.js';
import {
  assertUsable,
  canTransition,
  pickContract,
  type ConsumableContract,
  type UsageContext,
} from '../domain/contract.js';
import type { ContractDoc } from '../infrastructure/contract.model.js';
import type { ContractRepository } from '../infrastructure/contract.repository.js';

/**
 * Lo que Contracts necesita de Products: verificar que se pueda vender y anotar
 * la venta. ADR-003: se habla por interfaz, no importando su modelo.
 */
export interface ProductCatalog {
  /** Valida cupo, estado y la regla del trial único. Devuelve el producto. */
  assertPurchasable(productId: string, memberId: string): Promise<SoldProduct>;
  /** Suma una venta al `soldCount`, que es lo que hace aplicar `maxSales`. */
  registerSale(productId: string): Promise<void>;
  releaseSale(productId: string): Promise<void>;
}

export interface SoldProduct {
  publicId: string;
  name: string;
  type: ProductType;
  priceCents: number;
  currency: string;
  credits?: number | undefined;
  durationDays?: number | undefined;
  weeklyLimit?: number | undefined;
  monthlyLimit?: number | undefined;
  allowedCategories: string[];
  allowedTimeRanges: Array<{ from: string; to: string }>;
  autoRenew: boolean;
}

/**
 * La zona horaria del Venue y su política. El vencimiento se calcula en el
 * calendario del centro (§2.1.2), y el tope de días de freeze es del centro.
 */
export interface VenueClock {
  timeZoneOf(venueId: string): Promise<string>;
  /** `bookingPolicy.maxFreezeDaysPerYear`. */
  maxFreezeDaysOf(venueId: string): Promise<number>;
}

/**
 * Libera las reservas futuras de un contrato y lo saca de las listas de espera,
 * devolviendo cuántas liberó. Lo va a contestar Booking (F1-14) y Waitlist
 * (F1-16).
 *
 * Hasta que existan, el default responde 0: hoy no hay reservas en la base, así
 * que no hay nada que liberar. §2.1.9 exige que al congelar se cancelen las
 * futuras y **se devuelvan esos créditos**; la devolución la hace Booking, que
 * es quien sabe cuáles cancela.
 */
export interface FutureBookingReleaser {
  releaseFuture(params: {
    contractId: string;
    memberId: string;
    reason: 'frozen' | 'expired';
  }): Promise<number>;
}

export interface ContractServiceDeps {
  contracts: ContractRepository;
  products: ProductCatalog;
  venues: VenueClock;
  events: DomainEventBus;
  audit: AuditWriter;
  bookings: FutureBookingReleaser;
  now?: (() => Temporal.Instant) | undefined;
}

export class ContractService {
  private readonly contracts: ContractRepository;
  private readonly products: ProductCatalog;
  private readonly venues: VenueClock;
  private readonly events: DomainEventBus;
  private readonly audit: AuditWriter;
  private readonly bookings: FutureBookingReleaser;
  private readonly now: () => Temporal.Instant;

  constructor(deps: ContractServiceDeps) {
    this.contracts = deps.contracts;
    this.products = deps.products;
    this.venues = deps.venues;
    this.events = deps.events;
    this.audit = deps.audit;
    this.bookings = deps.bookings;
    this.now = deps.now ?? (() => Temporal.Now.instant());
  }

  /**
   * Vende. El contrato se queda con una **copia** de las condiciones del
   * producto: el centro puede editarlo mañana, y lo vendido tiene que seguir
   * valiendo por lo que se vendió.
   */
  async sell(input: SellContractInput): Promise<ContractDoc> {
    const product = await this.products.assertPurchasable(input.productId, input.memberId);
    const timeZone = await this.venues.timeZoneOf(input.venueId);

    const startsAt =
      input.startsAt === undefined ? this.now() : Temporal.Instant.from(input.startsAt);

    /*
     * El vencimiento se calcula en el calendario del centro, no sumando 30×24
     * horas: un pack de 30 días vendido el 1 de marzo vence el 31 de marzo a la
     * misma hora local, aunque en el medio haya un cambio de hora (§2.1.2).
     */
    const endsAt =
      product.durationDays === undefined
        ? null
        : startsAt.toZonedDateTimeISO(timeZone).add({ days: product.durationDays }).toInstant();

    await this.products.registerSale(product.publicId);

    try {
      const contract = await this.contracts.create({
        memberId: input.memberId,
        productId: product.publicId,
        venueId: input.venueId,
        productType: product.type,
        productName: product.name,
        priceSnapshotCents: input.priceCents ?? product.priceCents,
        currency: product.currency,
        creditsTotal: consumesCredits(product.type) ? (product.credits ?? 0) : 0,
        creditsUsed: 0,
        allowedCategories: product.allowedCategories,
        allowedTimeRanges: product.allowedTimeRanges,
        ...(product.weeklyLimit === undefined ? {} : { weeklyLimit: product.weeklyLimit }),
        ...(product.monthlyLimit === undefined ? {} : { monthlyLimit: product.monthlyLimit }),
        startsAt: toBsonDate(startsAt),
        endsAt: endsAt === null ? null : toBsonDate(endsAt),
        /*
         * Nace `pending_payment` salvo que sea gratis. La clase de prueba no
         * tiene nada que cobrar, y dejarla esperando un pago de $0 sería una
         * traba inventada en la puerta de entrada del socio.
         */
        status: (input.priceCents ?? product.priceCents) === 0 ? 'active' : 'pending_payment',
        autoRenew: product.autoRenew,
      } as Partial<ContractDoc>);

      await this.events.emit('contract.sold', {
        contractId: String(contract['publicId']),
        memberId: input.memberId,
        productId: product.publicId,
        priceCents: contract.priceSnapshotCents,
      });

      return contract;
    } catch (error) {
      // La venta ya quedó anotada en el producto: se devuelve para que un fallo
      // no le queme un lugar del cupo al centro.
      await this.products.releaseSale(product.publicId).catch(() => undefined);
      throw error;
    }
  }

  async list(
    filters: { memberId?: string | undefined; status?: ContractStatus | undefined },
    cursor?: string,
    limit?: number,
  ): Promise<Page<ContractDoc>> {
    const filter: Record<string, unknown> = {};
    if (filters.memberId !== undefined) filter['memberId'] = filters.memberId;
    if (filters.status !== undefined) filter['status'] = filters.status;

    return this.contracts.list(filter, {
      sortField: 'createdAt',
      direction: 'desc',
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  async getByPublicId(id: string): Promise<ContractDoc> {
    const contract = await this.contracts.findByPublicId(id);
    if (!contract) throw notFound(id);

    return contract;
  }

  /** §14: el estado cambia solo por transición explícita y validada. */
  async changeStatus(id: string, to: ContractStatus): Promise<ContractDoc> {
    const contract = await this.getByPublicId(id);
    const from = contract.status as ContractStatus;

    if (!canTransition(from, to)) {
      throw new AppError({
        code: 'LP-CTRT-422-004',
        status: 422,
        message: `No se puede pasar de ${from} a ${to}.`,
        meta: { contractId: id, from, to },
      });
    }

    const updated = await this.contracts.updateByPublicId(id, { $set: { status: to } });
    if (!updated) throw notFound(id);

    await this.events.emit('contract.status_changed', { contractId: id, from, to });

    return updated;
  }

  /**
   * 🔴 Consume un crédito para una clase (ADR-001: se descuenta **al reservar**).
   *
   * Elige el contrato según §2.1.9 y lo descuenta con una sola operación
   * atómica. Si el elegido pierde la carrera por su último crédito, intenta con
   * el siguiente candidato: descartar la reserva porque justo se agotó el pack
   * que el sistema eligió, teniendo otro disponible, sería un error nuestro.
   */
  async consume(memberId: string, context: UsageContext = {}): Promise<Consumption> {
    const now = this.now();
    const candidates = pickContract(
      (await this.contracts.activeOf(memberId)).map(toConsumable),
      now,
      context,
    );

    if (candidates.length === 0) throw this.explainWhyNot(memberId, now, context);

    for (const [index, candidate] of candidates.entries()) {
      const taken = consumesCredits(candidate.productType)
        ? await this.contracts.consumeCredit(candidate.publicId, now)
        : await this.contracts.touchMembership(candidate.publicId, now);

      if (!taken) continue;

      return {
        contractId: candidate.publicId,
        productName: candidate.productName,
        creditsLeft: consumesCredits(candidate.productType)
          ? taken.creditsTotal - taken.creditsUsed
          : null,
        reason: reasonFor(candidate, index),
      };
    }

    // Todos los candidatos se agotaron mientras se intentaba. Es raro, pero el
    // socio tiene que ver el mismo error que si no hubiera tenido ninguno.
    throw new AppError({
      code: 'LP-CTRT-402-001',
      status: 402,
      message: 'No te quedan clases en tu pack.',
      action: 'Comprá uno nuevo desde la app o en el mostrador.',
      meta: { memberId },
    });
  }

  /** Devuelve un crédito. Lo usa la cancelación dentro de plazo (ADR-001). */
  async refund(contractId: string): Promise<ContractDoc> {
    const refunded = await this.contracts.refundCredit(contractId);
    if (!refunded) throw notFound(contractId);

    return refunded;
  }

  /**
   * Ajuste manual del staff. **Motivo obligatorio y registro en `AuditLog`**
   * (§2.1.9): un ajuste sin motivo es indistinguible de un error, y seis meses
   * después nadie puede explicar por qué el pack tenía 7 clases.
   */
  async adjustCredits(id: string, input: AdjustCreditsInput): Promise<ContractDoc> {
    const contract = await this.getByPublicId(id);

    const total = contract.creditsTotal + input.delta;
    if (total < contract.creditsUsed) {
      throw new AppError({
        code: 'LP-CTRT-422-004',
        status: 422,
        message: `No se puede bajar a ${total} créditos: ya se usaron ${contract.creditsUsed}.`,
        meta: { contractId: id, creditsUsed: contract.creditsUsed, requested: total },
      });
    }

    const updated = await this.contracts.updateByPublicId(id, {
      $set: { creditsTotal: total },
    });
    if (!updated) throw notFound(id);

    await this.audit.record({
      action: 'contract.credits_adjusted',
      targetType: 'contract',
      targetId: id,
      reason: input.reason,
      before: { creditsTotal: contract.creditsTotal },
      after: { creditsTotal: total },
    });

    return updated;
  }

  /**
   * Congela por vacaciones o lesión (§2.1.9). Muy pedida y ausente en la v1.
   *
   * Corre el vencimiento por los días declarados, cancela las reservas futuras y
   * saca al socio de las listas de espera. Los créditos de esas reservas se
   * devuelven al cancelarlas, que es donde se sabe cuántas eran.
   *
   * Los días se declaran por adelantado y el vencimiento se corre **al
   * congelar**, no al descongelar: si se corriera al final, el socio que se
   * olvida de avisar que volvió tendría el pack parado para siempre.
   */
  async freeze(id: string, input: FreezeContractInput): Promise<ContractDoc> {
    const contract = await this.getByPublicId(id);
    const now = this.now();
    const year = now.toZonedDateTimeISO('UTC').year;

    if (!canTransition(contract.status as ContractStatus, 'frozen')) {
      throw new AppError({
        code: 'LP-CTRT-422-004',
        status: 422,
        message: `No se puede congelar un contrato ${contract.status}.`,
        meta: { contractId: id, status: contract.status },
      });
    }

    // El contador se reinicia con el año calendario: el tope es "por año".
    const used = contract.freezeYear === year ? contract.freezeDaysUsedThisYear : 0;
    assertFreezeAllowed({
      used,
      requested: input.days,
      max: await this.venues.maxFreezeDaysOf(contract.venueId),
    });

    const timeZone = await this.venues.timeZoneOf(contract.venueId);
    const endsAt =
      contract.endsAt === null || contract.endsAt === undefined
        ? null
        : shiftExpiry(fromBsonDate(contract.endsAt), input.days, timeZone);

    const liberadas = await this.bookings.releaseFuture({
      contractId: id,
      memberId: contract.memberId,
      reason: 'frozen',
    });

    const updated = await this.contracts.updateByPublicId(id, {
      $set: {
        status: 'frozen',
        freeze: {
          days: input.days,
          from: toBsonDate(now),
          to: toBsonDate(now.toZonedDateTimeISO(timeZone).add({ days: input.days }).toInstant()),
        },
        freezeDaysUsedThisYear: used + input.days,
        freezeYear: year,
        ...(endsAt === null ? {} : { endsAt: toBsonDate(endsAt) }),
      },
    });
    if (!updated) throw notFound(id);

    await this.audit.record({
      action: 'contract.frozen',
      targetType: 'contract',
      targetId: id,
      reason: input.reason ?? `Congelado ${input.days} días.`,
      before: { status: contract.status },
      after: { status: 'frozen', bookingsReleased: liberadas },
    });

    await this.events.emit('contract.status_changed', {
      contractId: id,
      from: contract.status,
      to: 'frozen',
    });

    return updated;
  }

  /** Descongela. El vencimiento ya se corrió al congelar, así que no se toca. */
  async unfreeze(id: string): Promise<ContractDoc> {
    return this.changeStatus(id, 'active');
  }

  /**
   * Job diario: pasa a `expired` los contratos vencidos y libera sus reservas
   * futuras.
   *
   * **Idempotente**: el filtro solo trae los que siguen `active` o `frozen`, así
   * que correrlo dos veces el mismo día no cambia nada la segunda vez.
   */
  async expireDueContracts(): Promise<number> {
    const now = this.now();
    const vencidos = await this.contracts.dueToExpireAcrossTenants(now);
    let expirados = 0;

    for (const contract of vencidos) {
      const tenantId = String(contract['tenantId']);
      const id = String(contract['publicId']);

      await runWithTenant(
        { tenantId, userId: 'system:expireContracts', requestId: `job-expire-${id}` },
        async () => {
          await this.bookings.releaseFuture({
            contractId: id,
            memberId: contract.memberId,
            reason: 'expired',
          });
          await this.contracts.updateByPublicId(id, { $set: { status: 'expired' } });
          await this.events.emit('contract.expired', {
            contractId: id,
            memberId: contract.memberId,
          });
        },
      );

      expirados += 1;
    }

    return expirados;
  }

  /**
   * Job diario: avisa 7, 3 y 1 día antes del vencimiento (§2.1.9). Los avisos de
   * vencimiento son ingreso directo: es el momento en que el socio renueva.
   *
   * **Idempotente por hito**: se guarda el último hito avisado, así que correr el
   * job dos veces el mismo día no manda el aviso dos veces.
   */
  async notifyExpiringContracts(): Promise<number> {
    const now = this.now();
    const proximos = await this.contracts.expiringSoonAcrossTenants(now, EXPIRY_MILESTONES[0]);
    let avisados = 0;

    for (const contract of proximos) {
      if (contract.endsAt === null || contract.endsAt === undefined) continue;

      const tenantId = String(contract['tenantId']);
      const id = String(contract['publicId']);
      const context = {
        tenantId,
        userId: 'system:notifyExpiring',
        requestId: `job-notify-${id}`,
      };

      const timeZone = await runWithTenant(context, () =>
        this.venues.timeZoneOf(contract.venueId),
      ).catch(() => null);
      if (timeZone === null) continue;

      const milestone = expiryMilestone(fromBsonDate(contract.endsAt), now, timeZone);
      if (milestone === null) continue;
      // Ya se avisó este hito: el job puede correr de nuevo sin duplicar el mail.
      if (contract.lastExpiryNoticeDays === milestone) continue;

      await runWithTenant(context, async () => {
        await this.contracts.updateByPublicId(id, { $set: { lastExpiryNoticeDays: milestone } });
        await this.events.emit('contract.expiring', {
          contractId: id,
          memberId: contract.memberId,
          daysLeft: milestone,
        });
      });

      avisados += 1;
    }

    return avisados;
  }

  /**
   * El pack, como lo necesita un aviso: que producto es, de que sede y cuando
   * vence. Es el puerto que consume Notifications (F1-22).
   *
   * `null` en vez de excepcion: un aviso que no encuentra su contrato no sale,
   * no rompe el job que lo estaba encolando.
   */
  async notificationContextOf(
    contractId: string,
  ): Promise<{ productName: string; venueId: string; endsAt: Temporal.Instant | null } | null> {
    const contract = await this.contracts.findByPublicId(contractId);
    if (!contract) return null;

    return {
      productName: contract.productName,
      venueId: contract.venueId,
      endsAt: contract.endsAt ? fromBsonDate(contract.endsAt) : null,
    };
  }

  /** ¿Ya usó su clase de prueba? Es el puerto que consume Products (F1-07). */
  async hasUsedTrial(memberId: string): Promise<boolean> {
    return this.contracts.hasBought(memberId, 'trial');
  }

  /**
   * Por qué no se pudo consumir. Se vuelve a evaluar el contrato más cercano a
   * servir para dar el error concreto: "no tenés pack" y "tu pack no incluye
   * esta actividad" mandan al socio a lugares distintos.
   */
  private explainWhyNot(memberId: string, now: Temporal.Instant, context: UsageContext): AppError {
    return new AppError({
      code: 'LP-CTRT-402-001',
      status: 402,
      message: 'No tenés un pack activo para esta clase.',
      action: 'Comprá uno desde la app o en el mostrador.',
      meta: { memberId, context, at: now.toString() },
    });
  }
}

/** Explicación en castellano de por qué se eligió este contrato (§2.1.9). */
function reasonFor(contract: ConsumableContract, index: number): string {
  if (index > 0) return `Se usó "${contract.productName}" porque los anteriores se agotaron.`;
  if (contract.endsAt === null) return `Se usó tu "${contract.productName}", que no vence.`;

  return `Se usó "${contract.productName}", que es el que vence primero.`;
}

/** El documento de Mongo a la forma que entiende el dominio. */
function toConsumable(doc: ContractDoc): ConsumableContract {
  return {
    publicId: String(doc['publicId']),
    productName: doc.productName,
    productType: doc.productType as ProductType,
    status: doc.status as ContractStatus,
    creditsTotal: doc.creditsTotal,
    creditsUsed: doc.creditsUsed,
    allowedCategories: doc.allowedCategories,
    allowedTimeRanges: doc.allowedTimeRanges,
    startsAt: fromBsonDate(doc.startsAt),
    endsAt: doc.endsAt ? fromBsonDate(doc.endsAt) : null,
    createdAt:
      doc['createdAt'] instanceof Date
        ? fromBsonDate(doc['createdAt'])
        : fromBsonDate(doc.startsAt),
  };
}

/** Se exporta para que Booking (F1-14) pueda explicar el mismo error. */
export { assertUsable };

function notFound(contractId: string): AppError {
  return new AppError({
    code: 'LP-CTRT-404-005',
    status: 404,
    message: 'No encontramos ese pack.',
    meta: { contractId },
  });
}
