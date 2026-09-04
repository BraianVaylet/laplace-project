import type { Temporal } from '@js-temporal/polyfill';

/**
 * Puertos de entrada de Metrics. Todo lo que necesita para contar lo pregunta
 * por interfaz: no importa el modelo de nadie (ADR-003).
 *
 * Son de **lectura y de conteo**, nunca de escritura: un módulo de métricas que
 * puede tocar datos es un módulo de métricas que algún día los va a tocar.
 */

/** Las sedes de todos los centros: es por donde arranca el job diario. */
export interface VenueDirectory {
  allAcrossTenants(): Promise<Array<{ tenantId: string; venueId: string; timeZone: string }>>;
  timeZoneOf(venueId: string): Promise<string>;
}

/** Las clases de una ventana de tiempo, con su cupo. La contesta Schedule. */
export interface SessionCounts {
  ofWindow(
    venueId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<Array<{ sessionId: string; capacity: number }>>;
}

/** Cuántas reservas de cada estado tienen esas clases. La contesta Booking. */
export interface BookingCounts {
  byStatusOf(sessionIds: readonly string[]): Promise<Record<string, number>>;
}

/** Socios activos de la sede. La contesta Members. */
export interface MemberCounts {
  activeIn(venueId: string): Promise<number>;
}

/** La plata del día, en el calendario del centro. La contesta Billing. */
export interface BillingTotals {
  ofDay(
    venueId: string,
    date: string,
    timeZone: string,
  ): Promise<{ incomeCents: number; chargedCents: number; overdueCents: number }>;
}
