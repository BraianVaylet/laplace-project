import { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy } from '@laplace/schemas';

/**
 * El no-show y su penalización (§2.1.5.d): quien reserva y no va le sacó el
 * lugar a otro, y el crédito no se devuelve (§2.1.9, fila `no_show`).
 *
 * Las dos reglas que evitan castigar de más viven acá: la ventana de check-in
 * tiene que haber **cerrado** —el que llegó tarde no es un ausente— y las
 * faltas se cuentan en una ventana móvil, no desde que el socio existe. Tres
 * faltas en tres años no son las tres faltas de un mes.
 */

/** ¿Ya se puede dar por ausente a quien no hizo check-in? */
export function isNoShowDue(
  policy: BookingPolicy,
  startAt: Temporal.Instant,
  now: Temporal.Instant,
): boolean {
  const cierre = startAt.add({ minutes: policy.checkInClosesMinutesAfter });

  return Temporal.Instant.compare(now, cierre) > 0;
}

/** Desde cuándo cuentan las faltas para el umbral. */
export function noShowWindowStart(policy: BookingPolicy, now: Temporal.Instant): Temporal.Instant {
  return now.subtract({ hours: policy.noShowWindowDays * 24 });
}

/**
 * Hasta cuándo queda bloqueado, o `null` si no corresponde penalizar.
 *
 * `noShowThreshold: 0` desactiva la política y `noShowBlockMinutes: 0` la deja
 * en cero: en los dos casos la falta **se marca igual**, porque la métrica se
 * mide siempre aunque el centro decida no castigar (§2.1.5.d).
 */
export function blockUntil(
  policy: BookingPolicy,
  noShowsInWindow: number,
  now: Temporal.Instant,
): Temporal.Instant | null {
  if (policy.noShowThreshold === 0 || policy.noShowBlockMinutes === 0) return null;
  if (noShowsInWindow < policy.noShowThreshold) return null;

  return now.add({ minutes: policy.noShowBlockMinutes });
}
