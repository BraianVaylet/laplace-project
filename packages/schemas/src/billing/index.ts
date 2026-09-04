import { z } from 'zod';
import { currencySchema } from '../venues/index.js';
import { priceCentsSchema } from '../products/index.js';

/**
 * Fuente única de validación de Billing, compartida front/back (ADR-003).
 *
 * El dinero entre el centro y sus socios (§2.1.16), que es el gap más grave de
 * la v1. Fase 1 cubre el registro **manual** — efectivo, transferencia, POS —
 * que es como cobra hoy la mayoría de los centros.
 *
 * Todo el dinero es **entero en centavos** (§3.1). Un float acá termina en un
 * saldo que no cierra y que nadie puede explicar.
 */

/** §14. `void` es el cargo anulado: nunca se borra, se anula. */
export const CHARGE_STATES = ['pending', 'paid', 'overdue', 'void'] as const;
export const chargeStatusSchema = z.enum(CHARGE_STATES);
export type ChargeStatus = z.infer<typeof chargeStatusSchema>;

export const CHARGE_TRANSITIONS: Record<ChargeStatus, readonly ChargeStatus[]> = {
  pending: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'void'],
  // Un cargo pagado se revierte con un reembolso, no volviendo a `pending`.
  paid: [],
  void: [],
};

/** §14. Fase 1 registra pagos manuales, que nacen `approved`. */
export const PAYMENT_STATES = [
  'pending',
  'approved',
  'rejected',
  'refunded',
  'chargeback',
] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * Cómo entró la plata. `other` existe para lo que no entra en las tres: un
 * canje, una compensación, un pago en dos mitades por medios distintos.
 */
export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const createChargeSchema = z.object({
  memberId: z.string().min(1, 'Elegí el socio.'),
  venueId: z.string().min(1, 'Elegí la sede.'),
  /** El contrato que originó el cargo, si lo hay. */
  contractId: z.string().optional(),
  amountCents: priceCentsSchema.refine(
    (cents) => cents > 0,
    'El monto tiene que ser mayor a cero.',
  ),
  currency: currencySchema.default('ARS'),
  /** Cuándo vence. Sin valor, vence hoy. */
  dueAt: z.string().datetime({ offset: true }).optional(),
  description: z.string().trim().min(2, 'Describí el cargo.').max(200),
});

export type CreateChargeInput = z.infer<typeof createChargeSchema>;

export const registerPaymentSchema = z.object({
  memberId: z.string().min(1, 'Elegí el socio.'),
  venueId: z.string().min(1, 'Elegí la sede.'),
  amountCents: priceCentsSchema.refine(
    (cents) => cents > 0,
    'El monto tiene que ser mayor a cero.',
  ),
  currency: currencySchema.default('ARS'),
  method: paymentMethodSchema,
  /**
   * Qué cargos salda. Vacío = se aplica a los vencidos primero, que es lo que
   * espera el mostrador cuando alguien paga "lo que debe".
   */
  chargeIds: z.array(z.string()).max(50).default([]),
  /** Número de comprobante, últimos dígitos de la tarjeta, lo que el centro anote. */
  receipt: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
});

export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;

/**
 * Un pago **nunca se borra**: se anula con un reembolso (§5.2.4). Es lo que
 * mantiene la caja auditable: si el pago desapareciera, el arqueo del día
 * anterior dejaría de coincidir y nadie sabría por qué.
 */
export const refundPaymentSchema = z.object({
  /** Sin valor, se reembolsa todo lo que queda del pago. */
  amountCents: priceCentsSchema.optional(),
  reason: z.string().trim().min(5, 'Escribí el motivo del reembolso.').max(300),
});

export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;

export const chargeSchema = z.object({
  publicId: z.string(),
  memberId: z.string(),
  venueId: z.string(),
  contractId: z.string().optional(),
  amountCents: z.number().int(),
  /** Cuánto se pagó de este cargo. Menor al total = pago parcial. */
  paidCents: z.number().int(),
  currency: currencySchema,
  dueAt: z.string(),
  status: chargeStatusSchema,
  description: z.string(),
  createdAt: z.string(),
});

export type Charge = z.infer<typeof chargeSchema>;

export const paymentSchema = z.object({
  publicId: z.string(),
  memberId: z.string(),
  venueId: z.string(),
  chargeIds: z.array(z.string()),
  amountCents: z.number().int(),
  /** Cuánto de este pago ya se reembolsó. */
  refundedCents: z.number().int(),
  currency: currencySchema,
  method: paymentMethodSchema,
  status: paymentStatusSchema,
  receipt: z.string().optional(),
  note: z.string().optional(),
  receivedAt: z.string(),
  /** Quién lo registró. En un arqueo que no cierra, es la primera pregunta. */
  receivedBy: z.string(),
  createdAt: z.string(),
});

export type Payment = z.infer<typeof paymentSchema>;

export const refundSchema = z.object({
  publicId: z.string(),
  paymentId: z.string(),
  amountCents: z.number().int(),
  reason: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});

export type Refund = z.infer<typeof refundSchema>;

/**
 * El estado de cobranza del socio, visible en tiempo real (§2.1.16).
 *
 * Es **derivado**, no un campo: se calcula sobre cargos y pagos. Guardarlo
 * obligaría a un job que lo mantenga al día y a que ese job no se atrase nunca.
 */
export const BILLING_STATUSES = ['clear', 'pending', 'overdue', 'credit'] as const;
export const billingStatusSchema = z.enum(BILLING_STATUSES);
export type BillingStatus = z.infer<typeof billingStatusSchema>;

/**
 * El estado de cuenta del socio: qué se le cobró, qué pagó y cuánto debe.
 *
 * `balanceCents` es **pagado menos cobrado**: negativo significa que debe, que
 * es como lo lee el mostrador ("está en menos veinte mil").
 */
export const accountStatementSchema = z.object({
  memberId: z.string(),
  currency: currencySchema,
  balanceCents: z.number().int(),
  /** Lo vencido e impago. Es el número que dispara la mora (F1-11). */
  overdueCents: z.number().int(),
  /** Al día, con algo por vencer, en mora, o con saldo a favor. */
  status: billingStatusSchema,
  charges: z.array(chargeSchema),
  payments: z.array(paymentSchema),
});

export type AccountStatement = z.infer<typeof accountStatementSchema>;

/**
 * El arqueo de caja de un día en una sede (§2.1.16).
 *
 * Se abre para cerrar el turno: lo que entró, separado por método de pago, con
 * el efectivo aparte porque es lo único que hay que contar a mano.
 */
export const tillSummarySchema = z.object({
  venueId: z.string(),
  /** El día del centro, en su zona horaria. `YYYY-MM-DD`. */
  date: z.string(),
  currency: currencySchema,
  totalCents: z.number().int(),
  /** Lo que entró por cada método. Los métodos sin movimiento no aparecen. */
  byMethod: z.array(
    z.object({
      method: paymentMethodSchema,
      count: z.number().int(),
      grossCents: z.number().int(),
      refundedCents: z.number().int(),
      netCents: z.number().int(),
    }),
  ),
  /** Lo que tiene que estar en el cajón al cerrar. */
  cashCents: z.number().int(),
  paymentCount: z.number().int(),
  refundedCents: z.number().int(),
});

export type TillSummary = z.infer<typeof tillSummarySchema>;
