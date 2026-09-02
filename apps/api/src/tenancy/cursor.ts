import { AppError } from '../http/errors.js';

/**
 * Paginacion keyset (cursor-based). Spec §5.0: **obligatoria en todo listado**,
 * y nunca `skip`.
 *
 * `skip` obliga a Mongo a recorrer y descartar todos los documentos salteados:
 * en la pagina 200 de un listado de asistencias, eso es leer 4000 documentos
 * para devolver 20. El keyset salta directo con el indice.
 */
export type CursorValue = string | number;

export interface CursorPosition {
  /** Valor del campo por el que se ordena, del ultimo documento devuelto. */
  value: CursorValue;
  /** Desempate. Sin esto, dos documentos con el mismo valor se pierden o se repiten. */
  id: string;
}

export type SortDirection = 'asc' | 'desc';

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.value, position.id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  const invalid = () =>
    new AppError({
      code: 'LP-SYS-422-006',
      status: 422,
      message: 'La paginación no es válida.',
      action: 'Volvé a cargar el listado.',
    });

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }

  if (!Array.isArray(parsed) || parsed.length !== 2) throw invalid();

  const [value, id] = parsed as [unknown, unknown];
  const validValue = typeof value === 'string' || typeof value === 'number';
  if (!validValue || typeof id !== 'string' || id.length === 0) throw invalid();

  return { value, id };
}

/**
 * La condicion que salta a la pagina siguiente. Se combina con el filtro del
 * repositorio, que ya trae el `tenantId`.
 */
export function keysetFilter(
  position: CursorPosition | null,
  sortField: string,
  direction: SortDirection,
): Record<string, unknown> {
  if (!position) return {};

  const operator = direction === 'desc' ? '$lt' : '$gt';

  return {
    $or: [
      { [sortField]: { [operator]: position.value } },
      { [sortField]: position.value, _id: { [operator]: position.id } },
    ],
  };
}
