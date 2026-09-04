import type { Temporal } from '@js-temporal/polyfill';
import { EXPIRY_MILESTONES, type ExpiryMilestone } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * Congelamiento y vencimiento (§2.1.9).
 *
 * Todo lo de acá se calcula en **días de calendario del centro**, nunca en
 * bloques de 24 horas. Es la diferencia que §Testing.6 marca como test
 * obligatorio: en una zona con horario de verano, 30 días y 30×24 horas no dan
 * la misma fecha, y el que se entera es el socio al que el pack le venció una
 * hora antes.
 *
 * Reglas puras, sin Mongoose ni Hono.
 */

/** Corre el vencimiento la cantidad de días declarada, en el calendario del centro. */
export function shiftExpiry(
  endsAt: Temporal.Instant,
  days: number,
  timeZone: string,
): Temporal.Instant {
  return endsAt.toZonedDateTimeISO(timeZone).add({ days }).toInstant();
}

export interface FreezeAllowance {
  /** Días ya usados este año calendario. */
  used: number;
  requested: number;
  /** Tope del centro (`bookingPolicy.maxFreezeDaysPerYear`). `0` desactiva la función. */
  max: number;
}

/** El tope anual de días de congelamiento, configurable por el centro (§2.1.9). */
export function assertFreezeAllowed({ used, requested, max }: FreezeAllowance): void {
  if (used + requested <= max) return;

  const left = Math.max(0, max - used);

  throw new AppError({
    code: 'LP-CTRT-422-006',
    status: 422,
    // El número va en el mensaje: sin él, el staff prueba de a un día hasta que
    // entra, delante del socio.
    message:
      max === 0
        ? 'Este centro no habilita congelar contratos.'
        : `Ya usaste ${used} de los ${max} días de congelamiento de este año: te quedan ${left}.`,
    meta: { used, requested, max, left },
  });
}

/**
 * A cuántos días de calendario del vencimiento está hoy, si es uno de los hitos
 * de aviso (§2.1.9). `null` cuando no toca avisar.
 *
 * Se compara la **fecha** del centro y no la diferencia de horas: un pack que
 * vence a las 23:00 del 15 sigue estando "a 1 día" a las 08:00 del 14, aunque
 * falten 39 horas.
 */
export function expiryMilestone(
  endsAt: Temporal.Instant,
  now: Temporal.Instant,
  timeZone: string,
): ExpiryMilestone | null {
  const vence = endsAt.toZonedDateTimeISO(timeZone).toPlainDate();
  const hoy = now.toZonedDateTimeISO(timeZone).toPlainDate();
  const faltan = hoy.until(vence, { largestUnit: 'day' }).days;

  return EXPIRY_MILESTONES.find((milestone) => milestone === faltan) ?? null;
}
