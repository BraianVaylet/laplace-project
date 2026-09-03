import { AppError } from '../../../http/errors.js';

/**
 * Plantillas con variables (§2.1.14): `{{nombre}}`, `{{clase}}`, `{{hora}}`.
 *
 * El SMU las edita, así que el motor tiene que aguantar que se equivoque: una
 * variable que no existe **no** se manda con el `{{hueco}}` puesto ni con un
 * "undefined" en el medio del mail — se rechaza al guardar, que es cuando la
 * persona todavía está mirando la pantalla y puede arreglarlo.
 */
const VARIABLE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Las variables que una plantilla usa, sin repetir y en orden de aparición. */
export function variablesOf(template: string): string[] {
  const encontradas = new Set<string>();
  for (const [, nombre] of template.matchAll(VARIABLE)) encontradas.add(nombre as string);

  return [...encontradas];
}

/**
 * Reemplaza cada `{{variable}}` por su valor.
 *
 * Falta una: es un error, no un hueco. Un recordatorio que dice "Tu clase de
 * {{clase}} es a las {{hora}}" sin resolver es peor que no mandar nada.
 */
export function render(template: string, values: Record<string, string>): string {
  const faltantes = variablesOf(template).filter((nombre) => values[nombre] === undefined);
  if (faltantes.length > 0) throw missingVariables(faltantes);

  return template.replaceAll(VARIABLE, (_, nombre: string) => values[nombre] as string);
}

/**
 * ¿Esta plantilla se puede resolver con estas variables? Es lo que valida el
 * guardado y lo que hace posible la vista previa (§2.1.14).
 */
export function assertRenderable(template: string, allowed: readonly string[]): void {
  const desconocidas = variablesOf(template).filter((nombre) => !allowed.includes(nombre));
  if (desconocidas.length > 0) throw unknownVariables(desconocidas, allowed);
}

function missingVariables(faltantes: readonly string[]): AppError {
  return new AppError({
    code: 'LP-NOTF-422-002',
    status: 422,
    message: `Faltan datos para armar el aviso: ${faltantes.join(', ')}.`,
    meta: { faltantes: [...faltantes] },
  });
}

function unknownVariables(desconocidas: readonly string[], allowed: readonly string[]): AppError {
  return new AppError({
    code: 'LP-NOTF-422-002',
    status: 422,
    message: `La plantilla usa variables que no existen: ${desconocidas.join(', ')}.`,
    action: `Las disponibles son: ${allowed.join(', ')}.`,
    meta: { desconocidas: [...desconocidas], disponibles: [...allowed] },
  });
}
