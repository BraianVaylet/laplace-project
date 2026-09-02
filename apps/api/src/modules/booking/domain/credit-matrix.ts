/**
 * 🔴 La tabla de §2.1.9: qué le pasa al crédito en cada evento.
 *
 * Vive acá, en una función pura, y no repartida por los servicios que la
 * aplican. La misma regla la consultan Booking (reserva y cancelación),
 * Schedule (clase cancelada), Contracts (congelamiento), Attendance (walk-in) y
 * el job de no-shows: cinco copias de una regla de plata son cinco versiones de
 * la verdad, y la que se desactualiza le cobra de más a alguien.
 */
export const CREDIT_EVENTS = [
  'booking_created',
  'cancelled_in_time',
  'late_cancelled',
  'no_show',
  'session_cancelled',
  'contract_frozen',
  'walk_in',
  'manual_adjustment',
] as const;

export type CreditEvent = (typeof CREDIT_EVENTS)[number];

/**
 * - `consume`: se descuenta 1 crédito.
 * - `refund`: se devuelve al contrato del que salió.
 * - `keep`: ya está consumido y así queda.
 * - `consume_at_check_in`: se descuenta recién al entrar (ADR-001).
 * - `audited`: lo mueve el staff a mano, con motivo y `AuditLog`.
 */
export type CreditEffect = 'consume' | 'refund' | 'keep' | 'consume_at_check_in' | 'audited';

/** Lo único configurable de la tabla es qué pasa con el que cancela tarde. */
export interface CreditPolicy {
  lateCancelPolicy: 'no_refund' | 'refund' | 'refund_and_notify';
}

export function creditEffectOf(
  event: CreditEvent,
  /** Solo lo mira `late_cancelled`; el resto de la tabla no es configurable. */
  policy: CreditPolicy = { lateCancelPolicy: 'no_refund' },
): CreditEffect {
  switch (event) {
    case 'booking_created':
      return 'consume';

    case 'cancelled_in_time':
      // El lugar vuelve a la clase con tiempo de que otro lo tome.
      return 'refund';

    case 'late_cancelled':
      return policy.lateCancelPolicy === 'no_refund' ? 'keep' : 'refund';

    case 'no_show':
      return 'keep';

    case 'session_cancelled':
      // La clase no se dio: acá no se mira ninguna ventana, el socio no hizo
      // nada mal.
      return 'refund';

    case 'contract_frozen':
      return 'refund';

    case 'walk_in':
      return 'consume_at_check_in';

    case 'manual_adjustment':
      return 'audited';
  }
}

/** ¿El centro además quiere avisar cuando devuelve por un late cancel? */
export function notifiesLateCancelRefund(policy: CreditPolicy): boolean {
  return policy.lateCancelPolicy === 'refund_and_notify';
}
