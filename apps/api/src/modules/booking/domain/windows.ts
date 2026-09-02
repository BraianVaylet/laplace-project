import { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy, CategoryBookingPolicy } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * Las cinco ventanas de §2.1.5.c, resueltas contra instantes.
 *
 * Todo se calcula sobre el inicio de la clase y nunca sobre "la fecha de hoy":
 * la clase de las 6:00 en Buenos Aires y el reloj del servidor en UTC son el
 * mismo instante, y en cuanto se mezcla una fecha local con una comparación de
 * instantes el producto se equivoca de día dos veces al año.
 */
export type EffectivePolicy = BookingPolicy;

/**
 * La política que rige para una categoría: la del centro con las excepciones de
 * esa categoría encima (§2.1.5.c). Sin excepciones, es la del centro tal cual.
 */
export function policyFor(venue: BookingPolicy, categoryId: string | undefined): EffectivePolicy {
  const excepcion: CategoryBookingPolicy | undefined =
    categoryId === undefined ? undefined : venue.categoryPolicies[categoryId];
  if (!excepcion) return venue;

  // `undefined` no pisa: una categoría que solo cambia el corte de cancelación
  // no puede borrarle el resto de la configuración al centro.
  const definidas = Object.fromEntries(
    Object.entries(excepcion).filter(([, valor]) => valor !== undefined),
  );

  return { ...venue, ...definidas };
}

export interface BookingWindow {
  opensAt: Temporal.Instant;
  closesAt: Temporal.Instant;
}

export function bookingWindowOf(policy: EffectivePolicy, startAt: Temporal.Instant): BookingWindow {
  return {
    opensAt: startAt.subtract({ minutes: policy.bookingOpensMinutesBefore }),
    closesAt: startAt.subtract({ minutes: policy.bookingClosesMinutesBefore }),
  };
}

/** Hasta cuándo se cancela sin perder el crédito. */
export function cancelCutoffAt(
  policy: EffectivePolicy,
  startAt: Temporal.Instant,
): Temporal.Instant {
  return startAt.subtract({ minutes: policy.cancelCutoffMinutes });
}

export function isLateCancel(
  policy: EffectivePolicy,
  startAt: Temporal.Instant,
  now: Temporal.Instant,
): boolean {
  return Temporal.Instant.compare(now, cancelCutoffAt(policy, startAt)) > 0;
}

/** Desde cuándo y hasta cuándo se puede hacer check-in (lo consume F1-19). */
export function checkInWindowOf(policy: EffectivePolicy, startAt: Temporal.Instant): BookingWindow {
  return {
    opensAt: startAt.subtract({ minutes: policy.checkInOpensMinutesBefore }),
    closesAt: startAt.add({ minutes: policy.checkInClosesMinutesAfter }),
  };
}

/**
 * ¿Se puede reservar esta clase ahora?
 *
 * Los dos lados de la ventana devuelven el mismo código y mensajes distintos:
 * para quien reserva son el mismo problema — "no es el momento" —, pero
 * "todavía no" sin la fecha desde la que sí, no le sirve a nadie.
 */
export function assertWithinBookingWindow(
  policy: EffectivePolicy,
  startAt: Temporal.Instant,
  now: Temporal.Instant,
  timeZone = 'America/Argentina/Buenos_Aires',
): void {
  const { opensAt, closesAt } = bookingWindowOf(policy, startAt);

  if (Temporal.Instant.compare(now, opensAt) < 0) {
    throw new AppError({
      code: 'LP-BOOK-422-003',
      status: 422,
      message: `Todavía no se puede reservar esta clase: las reservas abren el ${fechaLarga(opensAt, timeZone)}.`,
      action: 'Volvé cuando abra la reserva.',
      meta: { opensAt: opensAt.toString() },
    });
  }

  if (Temporal.Instant.compare(now, closesAt) > 0) {
    throw new AppError({
      code: 'LP-BOOK-422-003',
      status: 422,
      message: `Las reservas de esta clase ya se cerraron: cerraron ${horaCorta(closesAt, timeZone)}.`,
      action: 'Consultá en el mostrador si todavía hay lugar.',
      meta: { closesAt: closesAt.toString() },
    });
  }
}

/**
 * El texto que el socio tiene que ver **antes** de confirmar (§2.1.5.d).
 *
 * Es la parte que hace que la política se sienta justa: la regla existe igual,
 * pero enterarse de que perdiste el crédito después de cancelar es lo que hace
 * que el centro parezca arbitrario.
 */
export function policyText(
  policy: EffectivePolicy,
  startAt: Temporal.Instant,
  timeZone: string,
): string {
  const corte = cancelCutoffAt(policy, startAt);
  const devuelve = policy.lateCancelPolicy !== 'no_refund';

  const cuando =
    policy.cancelCutoffMinutes === 0
      ? 'Podés cancelar hasta que empiece la clase y el crédito vuelve a tu pack.'
      : `Podés cancelar hasta las ${horaDe(corte.toZonedDateTimeISO(timeZone))} y el crédito vuelve a tu pack.`;

  const tarde = devuelve
    ? 'Si cancelás después, el crédito se te devuelve igual.'
    : 'Si cancelás después, el crédito no se te devuelve: el lugar ya no se puede dar a otra persona.';

  return `${cuando} ${tarde}`;
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "3 de marzo a las 10:00", en la hora del centro. */
function fechaLarga(instant: Temporal.Instant, timeZone: string): string {
  const local = instant.toZonedDateTimeISO(timeZone);

  return `${local.day} de ${MESES[local.month - 1]} a las ${horaDe(local)}`;
}

/** "a las 08:00", en la hora del centro. */
function horaCorta(instant: Temporal.Instant, timeZone: string): string {
  return `a las ${horaDe(instant.toZonedDateTimeISO(timeZone))}`;
}

function horaDe(local: Temporal.ZonedDateTime): string {
  return local.toPlainTime().toString({ smallestUnit: 'minute' });
}
