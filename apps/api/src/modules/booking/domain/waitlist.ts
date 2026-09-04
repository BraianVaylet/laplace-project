import { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * La lista de espera de §2.1.5.b: FIFO estricto, con ventana de confirmación y
 * promoción **automática**, sin que nadie del staff intervenga.
 *
 * Acá vive solo la aritmética: quién sigue, hasta cuándo se promueve y cuánto
 * tiene para confirmar. Quién toma el lugar y cuándo se descuenta el crédito lo
 * decide el servicio, que es el que puede hacerlo dentro de una transacción.
 */

/** La posición se le muestra al socio: la fila arranca en 1, no en 0. */
export function nextPosition(currentLength: number): number {
  return currentLength + 1;
}

export interface QueueEntry {
  publicId: string;
  waitlistPosition: number;
}

/**
 * Los que quedan atrás del que se fue, con su posición nueva.
 *
 * Devuelve solo los que se mueven: reescribir la fila entera en cada baja son
 * N escrituras para arreglar N−k, y en una clase con veinte esperando eso pasa
 * varias veces por hora.
 */
export function repositionAfter(queue: readonly QueueEntry[], leavingId: string): QueueEntry[] {
  const quienSeVa = queue.find((entry) => entry.publicId === leavingId);
  if (!quienSeVa) return [];

  return queue
    .filter((entry) => entry.waitlistPosition > quienSeVa.waitlistPosition)
    .map((entry) => ({ publicId: entry.publicId, waitlistPosition: entry.waitlistPosition - 1 }));
}

/** El tamaño máximo de la fila lo pone el centro; `0` la desactiva. */
export function assertWaitlistHasRoom(
  policy: BookingPolicy,
  currentLength: number,
  sessionId: string,
): void {
  if (currentLength < policy.waitlistMaxSize) return;

  throw new AppError({
    code: 'LP-BOOK-422-008',
    status: 422,
    message:
      policy.waitlistMaxSize === 0
        ? 'Esta clase está completa y el centro no tiene lista de espera.'
        : 'La lista de espera está completa.',
    action: 'Probá con otro horario.',
    meta: { sessionId, waitlistMaxSize: policy.waitlistMaxSize },
  });
}

/**
 * ¿Todavía tiene sentido promover a alguien?
 *
 * Pasado el `waitlistPromotionCutoff`, avisarle a una persona que se liberó un
 * lugar es mandarla a llegar tarde: el lugar queda libre y la clase arranca.
 */
export function canPromote(
  policy: BookingPolicy,
  startAt: Temporal.Instant,
  now: Temporal.Instant,
): boolean {
  const corte = startAt.subtract({ minutes: policy.waitlistPromotionCutoffMinutes });

  return Temporal.Instant.compare(now, corte) < 0;
}

/**
 * Hasta cuándo el promovido tiene el lugar guardado.
 *
 * Nunca más allá del inicio de la clase: una ventana de 15 minutos otorgada a
 * 5 del comienzo dejaría el lugar bloqueado después de que la clase empezó, y
 * nadie más podría tomarlo.
 */
export function holdExpiresAt(
  policy: BookingPolicy,
  startAt: Temporal.Instant,
  now: Temporal.Instant,
): Temporal.Instant {
  const vence = now.add({ minutes: policy.waitlistHoldMinutes });

  return Temporal.Instant.compare(vence, startAt) > 0 ? startAt : vence;
}
