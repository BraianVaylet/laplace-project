import { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy, BusinessHours, VenueStatus } from '@laplace/schemas';

/**
 * La sede: unidad de negocio con direccion, marca, zona horaria, moneda, caja y
 * metricas propias (§2.1.6).
 *
 * Reglas puras, sin Mongoose ni Hono.
 */
export interface Venue {
  publicId: string;
  name: string;
  address: string;
  phone?: string | undefined;
  timeZone: string;
  currency: 'ARS';
  businessHours: BusinessHours[];
  bookingPolicy: BookingPolicy;
  branding?: { logoUrl?: string; primaryColor?: string } | undefined;
  geo?: { lat: number; lng: number } | undefined;
  status: VenueStatus;
}

/**
 * Transiciones validas del estado de la sede (§14: solo por transicion
 * explicita, nunca con un update libre del campo).
 *
 * Archivar no borra: libera el cupo del plan y preserva el historico (§2.1.6).
 */
const TRANSITIONS: Record<VenueStatus, readonly VenueStatus[]> = {
  active: ['archived'],
  archived: ['active'],
};

export function canTransition(from: VenueStatus, to: VenueStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Solo las sedes activas cuentan contra el limite del plan (§2.2.1). */
export function countsTowardPlanLimit(status: VenueStatus): boolean {
  return status === 'active';
}

/**
 * El "ahora" del centro, en SU zona horaria. Es el reloj con el que se calculan
 * los vencimientos: un pack a 30 dias vence segun el calendario del centro, no
 * segun donde este parado el servidor (§2.1.2).
 */
export function venueNow(
  venue: Pick<Venue, 'timeZone'>,
  instant: Temporal.Instant = Temporal.Now.instant(),
): Temporal.ZonedDateTime {
  return instant.toZonedDateTimeISO(venue.timeZone);
}

/** El dia de calendario del centro para un instante dado. */
export function venueToday(
  venue: Pick<Venue, 'timeZone'>,
  instant: Temporal.Instant = Temporal.Now.instant(),
): Temporal.PlainDate {
  return venueNow(venue, instant).toPlainDate();
}

/** ¿Esta abierto el centro en ese instante, segun sus horarios de atencion? */
export function isOpenAt(
  venue: Pick<Venue, 'timeZone' | 'businessHours'>,
  instant: Temporal.Instant,
): boolean {
  // Sin horarios cargados no se bloquea nada: el centro todavia no los declaro.
  if (venue.businessHours.length === 0) return true;

  const local = venueNow(venue, instant);
  const time = local.toPlainTime().toString({ smallestUnit: 'minute' });

  return venue.businessHours.some(
    (hours) => hours.weekday === local.dayOfWeek && time >= hours.opensAt && time < hours.closesAt,
  );
}
