import type { Temporal } from '@js-temporal/polyfill';

/**
 * Cómo se ve una fecha adentro de un aviso.
 *
 * Va acá, puro, porque el texto que le llega al socio no puede depender de la
 * zona del servidor: "tu clase es a las 19:00" tiene que ser las 19:00 **del
 * centro**, y eso lo decide la conversión, no el formateador.
 */
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

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
] as const;

/**
 * "lunes 9 de marzo". Sin año: el socio recibe avisos de esta semana, y el año
 * solo agrega ruido.
 *
 * A mano y no con `Intl`: el formato de es-AR cambia entre versiones de Node y
 * de ICU, y el texto de un aviso no puede depender de con qué build corre.
 */
export function fechaLarga(local: Temporal.ZonedDateTime): string {
  const dia = DIAS[local.dayOfWeek - 1] as string;
  const mes = MESES[local.month - 1] as string;

  return `${dia} ${local.day} de ${mes}`;
}

/** "19:00", en la zona del centro. */
export function horaDe(local: Temporal.ZonedDateTime): string {
  return local.toPlainTime().toString({ smallestUnit: 'minute' });
}

/** "$18.000". Los montos viven en centavos enteros (§5.2.2). */
export function montoDe(cents: number): string {
  const pesos = Math.round(cents / 100);

  return `$${pesos.toLocaleString('es-AR')}`;
}
