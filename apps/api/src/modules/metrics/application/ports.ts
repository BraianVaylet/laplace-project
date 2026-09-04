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

// ── Lo que necesita el tablero del día (F1-24) ──────────────────────────────

/** Las clases de una ventana, con lo que el tablero muestra de cada una. */
export interface DashboardSessionLookup {
  ofWindow(
    venueId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<
    Array<{
      sessionId: string;
      name: string;
      capacity: number;
      startAt: Temporal.Instant;
      status: string;
    }>
  >;
}

/** Cuántos reservaron y cuántos entraron, clase por clase. */
export interface SessionOccupancy {
  bySession(
    sessionIds: readonly string[],
  ): Promise<Record<string, { booked: number; checkedIn: number }>>;
}

export interface AlertMember {
  memberId: string;
  fullName: string;
  balanceCents: number;
  lastAttendanceAt: Temporal.Instant | null;
}

export interface AlertMemberLookup {
  /** Socios activos que no vienen desde antes de ese instante. */
  inactiveSince(venueId: string, since: Temporal.Instant): Promise<AlertMember[]>;
  /** Los que deben plata, del que más debe al que menos. */
  debtors(venueId: string): Promise<AlertMember[]>;
  /** Los activos de la sede, para chequear waivers en bloque. */
  activeIn(venueId: string): Promise<AlertMember[]>;
}

export interface ContractAlertLookup {
  expiringIn(
    venueId: string,
    until: Temporal.Instant,
  ): Promise<
    Array<{ memberId: string; memberName: string; productName: string; endsAt: Temporal.Instant }>
  >;
}

export interface WaiverAlertLookup {
  /** De estos socios, a cuáles les falta firmar algo obligatorio. */
  missingAmong(memberIds: readonly string[]): Promise<string[]>;
}
