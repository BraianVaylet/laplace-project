import type { Temporal } from '@js-temporal/polyfill';

/**
 * Los umbrales del panel de alertas (§2.1.12).
 *
 * La spec dice que el panel de alertas accionables vale más que cualquier
 * gráfico, y es cierto por un motivo concreto: un gráfico se mira, una alerta
 * se toca. Por eso los umbrales están acá, puros y con nombre — el día que un
 * centro pida "avisame a los 21 días y no a los 14", se cambia un número y no
 * una consulta.
 */

/**
 * Sin venir hace dos semanas. §2.1.12: las asistencias por semana son el mejor
 * predictor individual de baja, y catorce días es donde la caída todavía se
 * puede revertir con un mensaje.
 */
export const INACTIVE_DAYS = 14;

/** Packs que vencen esta semana: es el plazo con el que se puede renovar sin cortar. */
export const EXPIRING_DAYS = 7;

/**
 * Menos de la mitad del cupo. Un horario al 40% sostenido no es un mal día: es
 * un horario que hay que mover o cerrar.
 */
export const LOW_OCCUPANCY_RATIO = 0.5;

/** Cuántos ítems muestra cada alerta. La lista completa está en su pantalla. */
export const ALERT_PREVIEW_SIZE = 5;

/**
 * Desde cuándo se considera que alguien dejó de venir, en el calendario del
 * centro. En hora local y no en UTC: el corte tiene que caer a la medianoche
 * del socio, no a las 21:00 del día anterior.
 */
export function inactiveSince(
  now: Temporal.Instant,
  timeZone: string,
  days = INACTIVE_DAYS,
): Temporal.Instant {
  return now.toZonedDateTimeISO(timeZone).startOfDay().subtract({ days }).toInstant();
}

/** Hasta cuándo se mira el vencimiento de los packs, en el calendario del centro. */
export function expiringUntil(
  now: Temporal.Instant,
  timeZone: string,
  days = EXPIRING_DAYS,
): Temporal.Instant {
  return now
    .toZonedDateTimeISO(timeZone)
    .startOfDay()
    .add({ days: days + 1 })
    .toInstant();
}

/** El día del centro, `YYYY-MM-DD`. Es el que titula el tablero. */
export function todayIn(now: Temporal.Instant, timeZone: string): string {
  return now.toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** La ventana del día del centro: de su medianoche a la siguiente. */
export function dayWindow(
  now: Temporal.Instant,
  timeZone: string,
): { from: Temporal.Instant; to: Temporal.Instant } {
  const inicio = now.toZonedDateTimeISO(timeZone).startOfDay();

  return { from: inicio.toInstant(), to: inicio.add({ days: 1 }).toInstant() };
}

/**
 * La semana que se mira para la baja ocupación: de hoy a siete días. Hacia
 * adelante y no hacia atrás — la clase de ayer con 3 de 16 ya pasó y no hay
 * nada que hacer; la de pasado mañana todavía se puede llenar o mover.
 */
export function weekWindow(
  now: Temporal.Instant,
  timeZone: string,
): { from: Temporal.Instant; to: Temporal.Instant } {
  const inicio = now.toZonedDateTimeISO(timeZone).startOfDay();

  return { from: inicio.toInstant(), to: inicio.add({ days: 7 }).toInstant() };
}

/** Ocupación de una clase, 0 a 1. Sin cupo declarado no hay ocupación que medir. */
export function occupancyOf(booked: number, capacity: number): number {
  if (capacity <= 0) return 0;

  return Math.round((booked / capacity) * 10_000) / 10_000;
}

/**
 * ¿Esta clase está vacía de más?
 *
 * La clase sin cupo declarado **no** entra: no se puede estar bajo un umbral
 * que no existe, y meterla llenaría el panel de falsos positivos.
 */
export function isLowOccupancy(
  booked: number,
  capacity: number,
  threshold = LOW_OCCUPANCY_RATIO,
): boolean {
  if (capacity <= 0) return false;

  return booked / capacity < threshold;
}
