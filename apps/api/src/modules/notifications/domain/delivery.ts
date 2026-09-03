import type { Temporal } from '@js-temporal/polyfill';
import { isCriticalEventType } from '@laplace/schemas';

/**
 * Las tres reglas que deciden **cuándo** sale un aviso y cuándo deja de
 * intentarse (§2.1.14).
 *
 * Viven acá, puras, porque son las que hay que poder explicar cuando alguien
 * pregunta "¿por qué no me llegó?" — y esa respuesta no puede depender de en
 * qué orden corrió el job.
 */

/**
 * Ventana horaria: nada sale entre las 22:00 y las 08:00 **del centro**.
 *
 * En hora local y no en UTC: un aviso "a las 8 de la mañana" calculado en UTC
 * le llega 5 de la madrugada a un socio argentino, que es exactamente lo que
 * la regla existe para evitar.
 */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 8;

/**
 * Cuándo se puede mandar esto. Si cae en la ventana de silencio, se difiere
 * hasta que abra — nunca se descarta: el aviso sigue siendo útil a las 8.
 */
export function sendableAt(
  desired: Temporal.Instant,
  timeZone: string,
  quiet: { fromHour: number; untilHour: number } = {
    fromHour: QUIET_FROM_HOUR,
    untilHour: QUIET_UNTIL_HOUR,
  },
): Temporal.Instant {
  const local = desired.toZonedDateTimeISO(timeZone);
  const hora = local.hour;

  // Antes de que abra el mismo día: espera unas horas.
  if (hora < quiet.untilHour) {
    return local.with({ hour: quiet.untilHour, minute: 0, second: 0, millisecond: 0 }).toInstant();
  }

  // Después del cierre: sale a la mañana siguiente.
  if (hora >= quiet.fromHour) {
    return local
      .add({ days: 1 })
      .with({ hour: quiet.untilHour, minute: 0, second: 0, millisecond: 0 })
      .toInstant();
  }

  return desired;
}

/**
 * El backoff de los reintentos (§2.1.14). 30 s, 2 min y 10 min: el primero
 * cubre el hipo de red, el segundo el reinicio del proveedor y el tercero una
 * caída corta. Después de eso el problema no se arregla esperando.
 */
export const RETRY_DELAYS_SECONDS = [30, 120, 600] as const;
/** Tres **reintentos** despues del primer envio: cuatro intentos en total. */
export const MAX_RETRIES = RETRY_DELAYS_SECONDS.length;

export interface RetryDecision {
  /** `null` cuando ya no se reintenta: el aviso queda fallido para soporte. */
  nextAttemptAt: Temporal.Instant | null;
  exhausted: boolean;
}

export function nextAttempt(attempts: number, now: Temporal.Instant): RetryDecision {
  const delay = RETRY_DELAYS_SECONDS[attempts - 1];
  if (delay === undefined) return { nextAttemptAt: null, exhausted: true };

  return { nextAttemptAt: now.add({ seconds: delay }), exhausted: false };
}

export interface PreferenceRow {
  channel: string;
  eventType: string;
  enabled: boolean;
}

/**
 * ¿Se le manda? El opt-out es por canal **y** por tipo de evento; sin
 * preferencia guardada, se manda (el default es recibir).
 */
export function isAllowed(
  eventType: string,
  channel: string,
  preferences: readonly PreferenceRow[],
): boolean {
  // Los avisos de plata salen igual: el opt-out no los alcanza (§2.1.14).
  if (isCriticalEventType(eventType)) return true;

  const propia = preferences.find(
    (pref) => pref.channel === channel && pref.eventType === eventType,
  );

  return propia?.enabled ?? true;
}
