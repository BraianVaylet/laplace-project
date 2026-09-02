/**
 * Catalogo de eventos de dominio (spec §6). Los modulos se comunican por aca y
 * no importandose entre si (ADR-003): es lo que permite que Notifications y
 * Metrics reaccionen a una reserva sin que Booking sepa que existen.
 *
 * El payload lleva IDs, no documentos: quien reacciona consulta lo que necesita
 * con su propio repositorio, ya acotado a su tenant.
 */
export interface DomainEvents {
  /**
   * Sede creada. Lo escucha Rooms para crear la sala por default: el 90% de los
   * centros tiene una sola y no deberia tener que crearla a mano (§1.1).
   */
  'venue.created': {
    venueId: string;
    name: string;
    timeZone: string;
  };

  /** Alta de socio. La escuchan Notifications (bienvenida) y Metrics. */
  'member.created': {
    memberId: string;
    status: string;
    venueIds: string[];
  };
  /**
   * Cambio de estado del socio. Es el que dispara los avisos de reactivacion y
   * el recalculo de churn, que necesitan saber DE DONDE venia.
   */
  'member.status_changed': {
    memberId: string;
    from: string;
    to: string;
  };

  /** Venta de un contrato. La escuchan Billing (genera el cargo) y Metrics. */
  'contract.sold': {
    contractId: string;
    memberId: string;
    productId: string;
    priceCents: number;
  };
  'contract.status_changed': {
    contractId: string;
    from: string;
    to: string;
  };

  /** Clase publicada en la grilla. La escuchan Notifications y Metrics. */
  'session.scheduled': {
    sessionId: string;
    venueId: string;
    startAt: string;
  };
  'session.status_changed': {
    sessionId: string;
    from: string;
    to: string;
  };

  'booking.created': {
    bookingId: string;
    sessionId: string;
    memberId: string;
    venueId: string;
  };
  'booking.cancelled': {
    bookingId: string;
    sessionId: string;
    memberId: string;
    /** Si la cancelacion devolvio el credito o fue late cancel (ADR-001). */
    creditRefunded: boolean;
  };
  'booking.waitlist_promoted': {
    bookingId: string;
    sessionId: string;
    memberId: string;
    confirmBefore: string;
  };
  'attendance.checked_in': {
    bookingId: string;
    memberId: string;
    method: 'self' | 'staff' | 'kiosk';
  };
  /** Un cargo entro en mora. Lo escucha Notifications para el aviso (§2.1.12). */
  'charge.overdue': {
    chargeId: string;
    memberId: string;
    /** Cuanto debe en total, no solo este cargo: es lo que va en el aviso. */
    overdueCents: number;
  };

  'payment.received': {
    paymentId: string;
    memberId: string;
    amountCents: number;
  };
  'contract.expiring': {
    contractId: string;
    memberId: string;
    daysLeft: number;
  };
  'contract.expired': {
    contractId: string;
    memberId: string;
  };
  'pr.achieved': {
    resultId: string;
    memberId: string;
    exerciseId: string;
  };
}

export type DomainEventName = keyof DomainEvents;
