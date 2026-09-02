/* eslint-disable no-restricted-syntax -- Ver el comentario de abajo: esta es la
   unica frontera del backend donde `Date` es correcto. */
import { Temporal } from '@js-temporal/polyfill';

/**
 * Frontera de conversion entre `Temporal` y el `Date` de BSON.
 *
 * La regla del proyecto es usar `Temporal` y nunca `Date` (spec §6): `Date` no
 * tiene zona horaria y arruina los calculos de vencimiento, que es donde
 * Laplace se juega la plata. Pero **el driver de Mongo persiste fechas como
 * BSON Date**, y los indices TTL solo funcionan sobre ese tipo.
 *
 * Asi que `Date` vive exactamente aca, en dos funciones de una linea, y el
 * resto del backend habla `Temporal`. Si aparece un `new Date()` en otro
 * archivo, el lint lo corta, y esta bien que lo corte.
 */

export function toBsonDate(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

export function fromBsonDate(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime());
}
