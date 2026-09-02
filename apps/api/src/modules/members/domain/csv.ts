import { AppError } from '../../../http/errors.js';

/**
 * Parser de CSV, subconjunto de RFC 4180 con lo que de verdad sale de un Excel
 * en es-AR.
 *
 * Se escribe a mano en vez de sumar una dependencia porque las reglas que
 * importan son cuatro —comillas, comillas escapadas, saltos adentro de comillas
 * y separador— y porque el archivo viene de un usuario: quiero poder leer
 * exactamente qué hace con una entrada rara.
 */

/** Tope de filas. Arriba de esto no es una migración, es un error. */
export const MAX_CSV_ROWS = 5000;

export interface ParsedCsv {
  /** Encabezados normalizados: sin espacios, sin acentos, en minúscula. */
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsv {
  // El BOM que agrega Excel al guardar como UTF-8. Sin sacarlo, la primera
  // columna se llama "\uFEFFnombre" y no matchea con nada.
  const clean = text.replace(/^\uFEFF/, '');
  if (clean.trim().length === 0) throw invalidCsv('El archivo está vacío.');

  const delimiter = detectDelimiter(clean);
  const records = splitRecords(clean, delimiter);

  const first = records.shift();
  if (!first) throw invalidCsv('El archivo está vacío.');

  const headers = first.map(normalizeHeader);
  if (records.length === 0) throw invalidCsv('El archivo no tiene ninguna fila de datos.');
  if (records.length > MAX_CSV_ROWS) {
    throw invalidCsv(`El archivo tiene más de ${MAX_CSV_ROWS} filas. Subilo en partes.`);
  }

  const rows = records.map((record, index) => {
    if (record.length > headers.length) {
      /*
       * Mas columnas que encabezados es el sintoma de un separador mal detectado
       * o de una comilla sin cerrar. Seguir de largo importaria los datos
       * corridos una columna, que es peor que no importar nada.
       */
      throw invalidCsv(
        `La fila ${index + 2} tiene ${record.length} columnas y el encabezado tiene ${headers.length}.`,
      );
    }

    // Las filas cortas se completan: quien exporta de una planilla deja celdas
    // finales vacías todo el tiempo, y eso no es un error del archivo.
    return [...record, ...Array.from({ length: headers.length - record.length }, () => '')];
  });

  return { headers, rows };
}

/**
 * El Excel en español exporta con `;`, porque la coma es el separador decimal.
 * Se elige el que más aparece en el encabezado.
 */
function detectDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  const commas = (header.match(/,/g) ?? []).length;
  const semicolons = (header.match(/;/g) ?? []).length;

  return semicolons > commas ? ';' : ',';
}

/** Sin espacios, sin acentos y en minúscula, para poder mapear columnas sin adivinar. */
function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('es-AR')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Recorre el texto carácter por carácter llevando el estado de "estoy dentro de
 * comillas". Es la única forma de que una coma o un salto de línea dentro de una
 * celda no partan el archivo.
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let touched = false;

  const endField = () => {
    record.push(field);
    field = '';
  };

  const endRecord = () => {
    endField();
    // Una línea totalmente vacía no es una fila: es un enter de más al final.
    if (touched) records.push(record);
    record = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;

    if (quoted) {
      if (char !== '"') {
        field += char;
        continue;
      }
      // Dos comillas seguidas adentro de comillas son una comilla literal.
      if (text[i + 1] === '"') {
        field += '"';
        i += 1;
        continue;
      }
      quoted = false;
      continue;
    }

    if (char === '"') {
      quoted = true;
      touched = true;
      continue;
    }

    if (char === delimiter) {
      touched = true;
      endField();
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      continue;
    }

    if (char.trim().length > 0) touched = true;
    field += char;
  }

  endRecord();

  return records;
}

function invalidCsv(detail: string): AppError {
  return new AppError({
    code: 'LP-MEMB-422-006',
    status: 422,
    message: `El archivo no tiene el formato esperado. ${detail}`,
    action: 'Revisá que sea un CSV con encabezado en la primera fila.',
    meta: { detail },
  });
}
