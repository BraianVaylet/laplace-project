import { Temporal } from '@js-temporal/polyfill';
import type { BookingPolicy } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * La ventana de check-in de §2.1.5.c, con sus dos bordes.
 *
 * Existen por motivos distintos: el de adelante evita que el socio marque
 * presente el martes la clase del jueves, y el de atrás es el que hace que el
 * no-show signifique algo — sin cierre, quien faltó podría marcarse presente al
 * día siguiente y la métrica de asistencia dejaría de medir nada.
 */
export interface CheckInWindow {
  opensAt: Temporal.Instant;
  closesAt: Temporal.Instant;
}

export function checkInWindowOf(policy: BookingPolicy, startAt: Temporal.Instant): CheckInWindow {
  return {
    opensAt: startAt.subtract({ minutes: policy.checkInOpensMinutesBefore }),
    closesAt: startAt.add({ minutes: policy.checkInClosesMinutesAfter }),
  };
}

export function assertWithinCheckInWindow(
  policy: BookingPolicy,
  startAt: Temporal.Instant,
  now: Temporal.Instant,
  timeZone = 'America/Argentina/Buenos_Aires',
): void {
  const { opensAt, closesAt } = checkInWindowOf(policy, startAt);
  const local = (instant: Temporal.Instant) =>
    instant.toZonedDateTimeISO(timeZone).toPlainTime().toString({ smallestUnit: 'minute' });

  if (Temporal.Instant.compare(now, opensAt) < 0) {
    throw new AppError({
      code: 'LP-ATTD-422-002',
      status: 422,
      message: `El check-in de esta clase abre a las ${local(opensAt)}.`,
      action: 'Volvé cuando abra.',
      meta: { opensAt: opensAt.toString() },
    });
  }

  if (Temporal.Instant.compare(now, closesAt) > 0) {
    throw new AppError({
      code: 'LP-ATTD-422-002',
      status: 422,
      message: `El check-in de esta clase cerró a las ${local(closesAt)}.`,
      action: 'Pedile al centro que lo registre a mano.',
      meta: { closesAt: closesAt.toString() },
    });
  }
}
