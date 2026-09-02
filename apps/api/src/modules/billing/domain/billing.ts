import {
  CHARGE_TRANSITIONS,
  type BillingStatus,
  type ChargeStatus,
  type PaymentMethod,
  type TillSummary,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * El dinero entre el centro y sus socios (§2.1.16).
 *
 * Todo se cuenta en **centavos enteros**. Reglas puras, sin Mongoose ni Hono.
 */

export interface PayableCharge {
  publicId: string;
  amountCents: number;
  paidCents: number;
  dueAt: string;
  status: ChargeStatus;
}

/** §14: los estados cambian solo por transición explícita y validada. */
export function canTransition(from: ChargeStatus, to: ChargeStatus): boolean {
  return CHARGE_TRANSITIONS[from].includes(to);
}

/** Lo que falta pagar de un cargo. Nunca negativo: pagar de más no genera crédito acá. */
export function outstandingOf(charge: PayableCharge): number {
  return Math.max(0, charge.amountCents - charge.paidCents);
}

/** Un cargo se salda cuando no le falta nada. */
export function isSettled(charge: PayableCharge): boolean {
  return outstandingOf(charge) === 0;
}

export interface Allocation {
  chargeId: string;
  /** Cuánto de este pago se imputa a este cargo. */
  cents: number;
}

/**
 * Reparte un pago entre cargos.
 *
 * El orden es **el más viejo primero**: es lo que espera el mostrador cuando
 * alguien paga "lo que debe", y lo que evita que quede una deuda vieja abierta
 * mientras se saldan las nuevas. Si el pago no alcanza para todos, el último
 * queda parcialmente pagado y sigue `pending`.
 *
 * Lo que sobra no se pierde: queda como saldo a favor en el balance del socio.
 */
export function allocatePayment(
  amountCents: number,
  charges: readonly PayableCharge[],
): { allocations: Allocation[]; leftoverCents: number } {
  const pendientes = [...charges]
    .filter((charge) => !isSettled(charge) && charge.status !== 'void')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const allocations: Allocation[] = [];
  let restante = amountCents;

  for (const charge of pendientes) {
    if (restante === 0) break;

    const cents = Math.min(restante, outstandingOf(charge));
    allocations.push({ chargeId: charge.publicId, cents });
    restante -= cents;
  }

  return { allocations, leftoverCents: restante };
}

export interface RefundablePayment {
  publicId: string;
  amountCents: number;
  refundedCents: number;
  status: string;
}

/**
 * Cuánto se puede devolver todavía de un pago. Un pago **nunca se borra**: se
 * anula con un reembolso (§5.2.4), y por eso hace falta saber cuánto queda.
 */
export function refundableOf(payment: RefundablePayment): number {
  return Math.max(0, payment.amountCents - payment.refundedCents);
}

export function assertRefundable(payment: RefundablePayment, requestedCents: number): void {
  const disponible = refundableOf(payment);

  if (requestedCents > disponible) {
    throw new AppError({
      code: 'LP-BILL-409-005',
      status: 409,
      // El monto va en el mensaje: el staff tiene que saber cuánto puede devolver.
      message: `El reembolso no puede superar los ${formatCents(disponible)} que quedan del pago.`,
      meta: {
        paymentId: payment.publicId,
        requestedCents,
        availableCents: disponible,
      },
    });
  }
}

/**
 * El saldo del socio: **pagado menos cobrado**, en centavos.
 *
 * Negativo significa que debe, que es como lo lee el mostrador ("está en menos
 * veinte mil"). Los cargos anulados no cuentan, y los reembolsos restan de lo
 * pagado: devolverle plata a alguien no le baja la deuda.
 */
export function balanceOf(
  charges: readonly { amountCents: number; status: ChargeStatus }[],
  payments: readonly { amountCents: number; refundedCents: number; status: string }[],
): number {
  const cobrado = charges
    .filter((charge) => charge.status !== 'void')
    .reduce((total, charge) => total + charge.amountCents, 0);

  const pagado = payments
    .filter((payment) => payment.status === 'approved' || payment.status === 'refunded')
    .reduce((total, payment) => total + payment.amountCents - payment.refundedCents, 0);

  return pagado - cobrado;
}

/** Lo vencido e impago. Es el número que dispara la mora (F1-11). */
export function overdueOf(charges: readonly PayableCharge[], nowIso: string): number {
  return charges
    .filter((charge) => charge.status !== 'void' && charge.status !== 'paid')
    .filter((charge) => charge.dueAt <= nowIso)
    .reduce((total, charge) => total + outstandingOf(charge), 0);
}

/** Pesos con dos decimales, solo para armar mensajes. La cuenta siempre es en centavos. */
function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

/**
 * El estado de cobranza que ve el staff, en tiempo real (§2.1.16). Es derivado:
 * guardarlo obligaria a un job que lo mantenga al dia y a que nunca se atrase.
 */
export function billingStatusOf(balanceCents: number, overdueCents: number): BillingStatus {
  if (overdueCents > 0) return 'overdue';
  if (balanceCents > 0) return 'credit';
  if (balanceCents < 0) return 'pending';

  return 'clear';
}

/**
 * El corte de la mora sobre una accion del socio (§2.1.12).
 *
 * `allowDebt` es del Venue y su default es `false` (ADR-004, decision 2): el
 * centro decide si deja reservar a quien debe. La morosidad es el KPI numero 1
 * del mercado argentino, y la palanca que la mueve es esta.
 */
export function assertNoArrears(overdueCents: number, allowDebt: boolean): void {
  if (allowDebt || overdueCents === 0) return;

  throw new AppError({
    code: 'LP-BOOK-403-005',
    status: 403,
    // El monto va en el mensaje: "regularizá" sin numero manda al socio al
    // mostrador a preguntar cuanto.
    message: `Tenés ${formatCents(overdueCents)} de deuda vencida.`,
    action: 'Regularizá para poder reservar.',
    meta: { overdueCents },
  });
}

export interface TillPayment {
  method: PaymentMethod;
  amountCents: number;
  refundedCents: number;
  status: string;
}

/**
 * El arqueo de un dia: lo que entro por cada metodo, con los reembolsos
 * restados.
 *
 * El efectivo va aparte porque es lo unico que hay que contar a mano al cerrar
 * el turno, y es donde aparecen las diferencias.
 */
export function summarizeTill(
  payments: readonly TillPayment[],
): Omit<TillSummary, 'venueId' | 'date' | 'currency'> {
  const validos = payments.filter(
    (payment) => payment.status === 'approved' || payment.status === 'refunded',
  );

  const porMetodo = new Map<PaymentMethod, { count: number; gross: number; refunded: number }>();
  for (const payment of validos) {
    const actual = porMetodo.get(payment.method) ?? { count: 0, gross: 0, refunded: 0 };

    porMetodo.set(payment.method, {
      count: actual.count + 1,
      gross: actual.gross + payment.amountCents,
      refunded: actual.refunded + payment.refundedCents,
    });
  }

  const byMethod = [...porMetodo.entries()]
    .map(([method, totales]) => ({
      method,
      count: totales.count,
      grossCents: totales.gross,
      refundedCents: totales.refunded,
      netCents: totales.gross - totales.refunded,
    }))
    .sort((a, b) => a.method.localeCompare(b.method));

  return {
    totalCents: byMethod.reduce((total, fila) => total + fila.netCents, 0),
    byMethod,
    cashCents: byMethod.find((fila) => fila.method === 'cash')?.netCents ?? 0,
    paymentCount: validos.length,
    refundedCents: byMethod.reduce((total, fila) => total + fila.refundedCents, 0),
  };
}

/** El arqueo como CSV, para pegarlo en la planilla del centro. */
export function tillToCsv(summary: TillSummary): string {
  const filas = [
    ['metodo', 'cantidad', 'bruto', 'reembolsado', 'neto'].join(','),
    ...summary.byMethod.map((fila) =>
      [fila.method, fila.count, fila.grossCents, fila.refundedCents, fila.netCents].join(','),
    ),
    ['TOTAL', summary.paymentCount, '', summary.refundedCents, summary.totalCents].join(','),
  ];

  return filas.join('\n');
}
