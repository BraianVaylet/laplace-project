import { Temporal } from '@js-temporal/polyfill';
import type { Recurrence } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * Expansor de la regla de recurrencia (§2.1.5.a).
 *
 * 🔴 Todo se calcula en **días de calendario y hora local del centro**, nunca
 * sumando horas. La clase de las 7:00 es a las 7:00 todo el año: si se expandiera
 * sumando 24 h, en el cambio de horario de verano pasaría a ser a las 6:00 o a
 * las 8:00, y el socio se encontraría el gimnasio cerrado.
 *
 * Reglas puras, sin Mongoose ni Hono.
 */

/** Tope de ocurrencias por expansión. Es un cinturón, no un límite de negocio. */
const MAX_OCCURRENCES = 1000;

export interface ExpansionWindow {
  /** Desde cuándo materializar, inclusive. */
  from: Temporal.Instant;
  /** Hasta cuándo, exclusive. */
  to: Temporal.Instant;
}

/**
 * Los instantes de inicio de cada clase dentro de la ventana.
 *
 * Se recorre día por día en el calendario del centro y se arma cada fecha con su
 * hora local. `Temporal` resuelve solo el salto del cambio de horario.
 */
export function expandRecurrence(
  recurrence: Recurrence,
  timeZone: string,
  window: ExpansionWindow,
): Temporal.Instant[] {
  const desde = Temporal.PlainDate.from(recurrence.from);
  const hasta = recurrence.until === undefined ? null : Temporal.PlainDate.from(recurrence.until);

  const primerDia = maxDate(desde, window.from.toZonedDateTimeISO(timeZone).toPlainDate());
  const ultimoDia = minDate(hasta, window.to.toZonedDateTimeISO(timeZone).toPlainDate());

  const ocurrencias: Temporal.Instant[] = [];
  let dia = primerDia;

  while (Temporal.PlainDate.compare(dia, ultimoDia) <= 0) {
    if (ocurrencias.length >= MAX_OCCURRENCES) break;

    if (recurrence.byWeekday.includes(dia.dayOfWeek) && matchesInterval(recurrence, desde, dia)) {
      /*
       * `toZonedDateTime` con una hora que no existe (el día que el reloj se
       * adelanta) la corre hacia adelante en vez de fallar. Es lo que se quiere:
       * la clase de las 2:30 de ese día única se da a las 3:30, no se pierde.
       */
      const inicio = dia.toZonedDateTime({ timeZone, plainTime: recurrence.timeOfDay }).toInstant();

      if (
        Temporal.Instant.compare(inicio, window.from) >= 0 &&
        Temporal.Instant.compare(inicio, window.to) < 0
      ) {
        ocurrencias.push(inicio);
      }
    }

    dia = dia.add({ days: 1 });
  }

  return ocurrencias;
}

/**
 * Con `interval: 2`, la clase va una semana sí y una no. Se cuenta desde la
 * **semana del `from`**, no desde el día de hoy: así la grilla no se corre
 * cuando el job vuelve a correr un mes después.
 */
function matchesInterval(
  recurrence: Recurrence,
  from: Temporal.PlainDate,
  day: Temporal.PlainDate,
): boolean {
  if (recurrence.interval === 1) return true;

  const inicioSemana = from.subtract({ days: from.dayOfWeek - 1 });
  const semanaDelDia = day.subtract({ days: day.dayOfWeek - 1 });
  // En dias y despues dividido siete: `total({ unit: 'week' })` sobre una
  // duracion de fechas exige un `relativeTo` que aca no aporta nada.
  const semanas = Math.round(inicioSemana.until(semanaDelDia).days / 7);

  return semanas % recurrence.interval === 0;
}

/**
 * Valida lo que el schema no puede: una regla que no genera ninguna clase en su
 * propia vigencia está mal armada, y descubrirlo recién cuando el job no crea
 * nada es descubrirlo tarde.
 */
export function assertProducesOccurrences(recurrence: Recurrence, timeZone: string): void {
  const desde = Temporal.PlainDate.from(recurrence.from).toZonedDateTime({ timeZone }).toInstant();
  const hasta =
    recurrence.until === undefined
      ? desde.add({ hours: 24 * 7 * recurrence.interval })
      : Temporal.PlainDate.from(recurrence.until)
          .add({ days: 1 })
          .toZonedDateTime({ timeZone })
          .toInstant();

  if (expandRecurrence(recurrence, timeZone, { from: desde, to: hasta }).length > 0) return;

  throw new AppError({
    code: 'LP-SCHD-422-004',
    status: 422,
    message: 'La repetición de la clase no es válida: no genera ninguna clase en su vigencia.',
    action: 'Revisá los días elegidos y las fechas de vigencia.',
    meta: { recurrence },
  });
}

/** ¿Se pisan dos clases en la misma sala? Los bordes que se tocan no se pisan. */
export function overlaps(
  a: { startAt: Temporal.Instant; endAt: Temporal.Instant },
  b: { startAt: Temporal.Instant; endAt: Temporal.Instant },
): boolean {
  return (
    Temporal.Instant.compare(a.startAt, b.endAt) < 0 &&
    Temporal.Instant.compare(b.startAt, a.endAt) < 0
  );
}

const maxDate = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(a, b) >= 0 ? a : b;

const minDate = (a: Temporal.PlainDate | null, b: Temporal.PlainDate) =>
  a === null ? b : Temporal.PlainDate.compare(a, b) <= 0 ? a : b;
