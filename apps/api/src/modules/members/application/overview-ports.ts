import type { Temporal } from '@js-temporal/polyfill';

/**
 * Lo que la ficha 360 necesita de los otros módulos (§2.1.7).
 *
 * Va por interfaz y no importando sus modelos (ADR-003): la ficha es una
 * pantalla que junta cosas, no una excusa para que Members conozca a Contracts,
 * Booking, Attendance y Waivers por dentro.
 *
 * 🔴 **Acá no hay ningún puerto de plata.** El estado de cuenta tiene su propio
 * endpoint con `billing:read`, y meterlo en este agregado haría que el coach
 * —que abre esta pantalla todos los días— reciba la deuda en la respuesta
 * (§2.1.12).
 */

/** Sus contratos, con lo que le queda y hasta cuándo. */
export interface MemberContractsPort {
  ofMember(memberId: string): Promise<
    Array<{
      contractId: string;
      productName: string;
      productType: string;
      status: string;
      creditsTotal: number;
      creditsUsed: number;
      endsAt: Temporal.Instant | null;
    }>
  >;
}

/** Sus reservas: las próximas para la agenda, las pasadas para la asistencia. */
export interface MemberBookingsPort {
  ofMember(memberId: string): Promise<
    Array<{
      bookingId: string;
      sessionId: string;
      className: string;
      startAt: Temporal.Instant;
      status: string;
    }>
  >;
}

/** Lo que firmó y si sigue vigente. */
export interface MemberWaiversPort {
  signedOf(memberId: string): Promise<
    Array<{
      documentId: string;
      title: string;
      version: number;
      acceptedAt: string;
      outdated: boolean;
    }>
  >;
}
