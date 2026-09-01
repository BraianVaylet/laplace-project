import { Temporal } from '@js-temporal/polyfill';

/**
 * Fechas y horas en la zona del **Venue**, no la del navegador.
 *
 * Es la regla de §2.1.2 y no es un detalle: el vencimiento de un pack "a 30
 * dias" se calcula en la TZ del centro. Un socio que abre la app de viaje en
 * España no puede ver que su pack vence un dia antes.
 */
export const LOCALE = 'es-AR';

export interface VenueTime {
  /** IANA. Ej: `America/Argentina/Buenos_Aires`. */
  timeZone: string;
}

function zoned(instant: Temporal.Instant, { timeZone }: VenueTime) {
  return instant.toZonedDateTimeISO(timeZone);
}

/** `15/03/2026` */
export function formatDate(instant: Temporal.Instant, venue: VenueTime): string {
  return zoned(instant, venue).toPlainDate().toLocaleString(LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** `19:00` */
export function formatTime(instant: Temporal.Instant, venue: VenueTime): string {
  return zoned(instant, venue).toPlainTime().toLocaleString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** `15/03/2026 19:00` */
export function formatDateTime(instant: Temporal.Instant, venue: VenueTime): string {
  return `${formatDate(instant, venue)} ${formatTime(instant, venue)}`;
}

/** `lunes 15 de marzo` */
export function formatLongDate(instant: Temporal.Instant, venue: VenueTime): string {
  return zoned(instant, venue).toPlainDate().toLocaleString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/**
 * La semana **arranca el lunes** (§6). El default de `es-AR` en algunos runtimes
 * es domingo, y una agenda de gimnasio que empieza el domingo se lee mal.
 */
export function startOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - 1 });
}

export function endOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return startOfWeek(date).add({ days: 6 });
}

/**
 * Suma dias **de calendario**, no de 24 horas.
 *
 * Es la diferencia que rompe los vencimientos: entre el 1 y el 31 de marzo hay
 * un cambio de horario de verano, y "30 dias" contados en horas cae una hora
 * antes. `Temporal` lo hace bien; `Date` no.
 */
export function addDaysInVenue(
  instant: Temporal.Instant,
  days: number,
  venue: VenueTime,
): Temporal.Instant {
  return zoned(instant, venue).add({ days }).toInstant();
}

/** Dias enteros que faltan, en la TZ del centro. Negativo si ya paso. */
export function daysUntil(
  target: Temporal.Instant,
  venue: VenueTime,
  from: Temporal.Instant = Temporal.Now.instant(),
): number {
  const start = zoned(from, venue).toPlainDate();
  const end = zoned(target, venue).toPlainDate();

  return start.until(end, { largestUnit: 'days' }).days;
}

/** Dinero: enteros en centavos, nunca float (§5.2.1). */
export function formatMoney(amountCents: number, currency = 'ARS'): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}
