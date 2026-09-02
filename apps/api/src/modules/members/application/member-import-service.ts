import { Temporal } from '@js-temporal/polyfill';
import {
  IMPORT_COLUMN_ALIASES,
  memberImportRowSchema,
  type ConfirmImportInput,
  type ImportResult,
  type MemberImportRow,
  type PreviewResult,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { parseCsv } from '../domain/csv.js';
import type { MemberDoc } from '../infrastructure/member.model.js';
import type { MemberRepository } from '../infrastructure/member.repository.js';

export interface MemberImportServiceDeps {
  members: MemberRepository;
}

type PreviewRow = PreviewResult['rows'][number];

/**
 * Importación masiva de socios (§2.1.7).
 *
 * Dos pasos a propósito: **previsualizar y después confirmar.** Un import que
 * escribe mientras valida deja el padrón a medio migrar y sin forma de saber qué
 * entró y qué no.
 */
export class MemberImportService {
  private readonly members: MemberRepository;

  constructor(deps: MemberImportServiceDeps) {
    this.members = deps.members;
  }

  /**
   * Lee el archivo y lo devuelve fila por fila, **sin escribir nada**.
   *
   * El `limit` viene del pedido y no del constructor porque son los entitlements
   * del centro activo: el mismo servicio atiende a todos.
   */
  async preview(csv: string, limit: number | null): Promise<PreviewResult> {
    const { headers, rows } = parseCsv(csv);
    const mapping = mapColumns(headers);

    if (!mapping.indexes.has('firstName') || !mapping.indexes.has('lastName')) {
      throw new AppError({
        code: 'LP-MEMB-422-006',
        status: 422,
        message: 'El archivo no tiene el formato esperado. Faltan las columnas nombre y apellido.',
        action: `Renombrá el encabezado: se aceptan ${IMPORT_COLUMN_ALIASES['firstName']?.join(', ')} y ${IMPORT_COLUMN_ALIASES['lastName']?.join(', ')}.`,
        meta: { headers },
      });
    }

    const previewed: PreviewRow[] = [];
    /** Documentos ya vistos EN EL ARCHIVO: dos filas con el mismo DNI también chocan. */
    const seenDocs = new Map<string, number>();

    for (const [index, row] of rows.entries()) {
      // +2 porque la fila 1 es el encabezado y `index` arranca en 0.
      const rowNumber = index + 2;
      const parsed = memberImportRowSchema.safeParse(rowToInput(row, mapping));

      if (!parsed.success) {
        previewed.push({
          rowNumber,
          status: 'invalid',
          data: null,
          issues: parsed.error.issues.map((issue) => ({
            column: columnLabel(String(issue.path[0] ?? ''), mapping),
            message: issue.message,
          })),
        });
        continue;
      }

      const docId = parsed.data.docId;
      if (docId !== undefined) {
        const repetida = seenDocs.get(docId);
        if (repetida !== undefined) {
          previewed.push({
            rowNumber,
            status: 'invalid',
            data: parsed.data,
            issues: [
              {
                column: columnLabel('docId', mapping),
                message: `El documento ${docId} ya aparece en la fila ${repetida} de este archivo.`,
              },
            ],
          });
          continue;
        }
        seenDocs.set(docId, rowNumber);

        const existente = await this.members.findByDocId(docId);
        if (existente) {
          previewed.push({
            rowNumber,
            status: 'duplicate',
            data: parsed.data,
            issues: [],
            existingMemberId: String(existente['publicId']),
          });
          continue;
        }
      }

      previewed.push({ rowNumber, status: 'new', data: parsed.data, issues: [] });
    }

    const current = await this.members.countActive();
    const wouldCreate = previewed.filter((row) => row.status === 'new').length;

    return {
      ignoredColumns: headers.filter((header) => !mapping.byHeader.has(header)),
      rows: previewed,
      summary: {
        total: previewed.length,
        new: wouldCreate,
        duplicate: previewed.filter((row) => row.status === 'duplicate').length,
        invalid: previewed.filter((row) => row.status === 'invalid').length,
      },
      planCheck: {
        limit,
        current,
        wouldCreate,
        exceeds: limit === null ? 0 : Math.max(0, current + wouldCreate - limit),
      },
    };
  }

  /**
   * Escribe. Valida **todo** antes de tocar la base: una fila inválida o un plan
   * excedido cortan el import entero sin haber escrito nada.
   */
  async confirm(input: ConfirmImportInput, limit: number | null): Promise<ImportResult> {
    const rows = input.rows;

    // 1. Documentos repetidos dentro del propio archivo.
    const seen = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      if (row.docId === undefined) continue;
      const previa = seen.get(row.docId);
      if (previa !== undefined) {
        throw new AppError({
          code: 'LP-MEMB-409-001',
          status: 409,
          message: `El documento ${row.docId} aparece dos veces en el archivo, en las filas ${previa} y ${index + 2}.`,
          meta: { docId: row.docId },
        });
      }
      seen.set(row.docId, index + 2);
    }

    // 2. Cuáles ya existen en el centro. Se resuelve antes de escribir para
    //    poder contar exactamente cuántos se crean y chequear el plan.
    const existing = new Map<string, MemberDoc>();
    for (const row of rows) {
      if (row.docId === undefined) continue;
      const found = await this.members.findByDocId(row.docId);
      if (found) existing.set(row.docId, found);
    }

    const toCreate = rows.filter((row) => row.docId === undefined || !existing.has(row.docId));

    // 3. El límite del plan, con el número exacto. Un "no entrás" sin decir por
    //    cuánto obliga al centro a borrar filas al azar hasta que entre.
    const current = await this.members.countActive();
    if (limit !== null && current + toCreate.length > limit) {
      const exceeds = current + toCreate.length - limit;
      throw new AppError({
        code: 'LP-ENTL-403-001',
        status: 403,
        message: `Tu plan admite ${limit} socios y ya tenés ${current}. De los ${toCreate.length} del archivo, ${exceeds} no entran.`,
        action: 'Pasá a un plan mayor o importá menos filas.',
        meta: { limit, current, wouldCreate: toCreate.length, exceeds },
      });
    }

    const details: ImportResult['details'] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const previo = row.docId === undefined ? undefined : existing.get(row.docId);

      if (previo) {
        if (input.onDuplicate === 'skip') {
          skipped += 1;
          details.push({
            rowNumber,
            action: 'skipped',
            reason: 'Ya existe un socio con ese documento.',
            memberId: String(previo['publicId']),
          });
          continue;
        }

        await this.members.updateByPublicId(String(previo['publicId']), {
          $set: withoutUndefined(row),
        });
        updated += 1;
        details.push({ rowNumber, action: 'updated', memberId: String(previo['publicId']) });
        continue;
      }

      try {
        const member = await this.members.create({
          ...withoutUndefined(row),
          venueIds: input.venueIds,
          status: 'lead',
          flags: { debtor: false, suspended: false },
          balanceCents: 0,
          joinedAt: toBsonDate(Temporal.Now.instant()),
          lastAttendanceAt: null,
          notes: [],
        } as never);

        created += 1;
        details.push({ rowNumber, action: 'created', memberId: String(member['publicId']) });
      } catch (error) {
        /*
         * Alguien dio de alta ese documento entre el chequeo y la escritura. Es
         * una ventana chica pero real, y el que la encuentra tiene que ver la
         * fila concreta, no un 500: con 143 filas, "algo falló" no sirve.
         */
        if (!isDuplicateKey(error)) throw error;

        throw new AppError({
          code: 'LP-MEMB-409-001',
          status: 409,
          message: `La fila ${rowNumber} tiene un documento que ya existe en el centro.`,
          action: 'Volvé a previsualizar el archivo: pudo darse de alta mientras importabas.',
          meta: { rowNumber, docId: row.docId, created },
        });
      }
    }

    return { created, updated, skipped, details };
  }
}

interface ColumnMapping {
  /** Campo del modelo → índice de columna en el archivo. */
  indexes: Map<string, number>;
  /** Encabezado del archivo → campo del modelo. Sirve para nombrar la columna en el error. */
  byHeader: Map<string, string>;
}

/** Encabezado del archivo → campo del modelo, por alias. */
function mapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { indexes: new Map(), byHeader: new Map() };

  for (const [field, aliases] of Object.entries(IMPORT_COLUMN_ALIASES)) {
    const index = headers.findIndex((header) => aliases.includes(header));
    if (index === -1) continue;

    mapping.indexes.set(field, index);
    mapping.byHeader.set(headers[index] as string, field);
  }

  return mapping;
}

/** Nombre de columna tal como lo ve el usuario, para que el error sea accionable. */
function columnLabel(field: string, mapping: ColumnMapping): string {
  for (const [header, mapped] of mapping.byHeader) {
    if (mapped === field) return header;
  }

  return IMPORT_COLUMN_ALIASES[field]?.[0] ?? field;
}

/** Una fila cruda a la forma que espera el schema. Las celdas vacías se omiten. */
function rowToInput(row: string[], mapping: ColumnMapping): Record<string, unknown> {
  const at = (field: string): string | undefined => {
    const index = mapping.indexes.get(field);
    if (index === undefined) return undefined;
    const value = row[index]?.trim();

    return value === undefined || value.length === 0 ? undefined : value;
  };

  const emergencyName = at('emergencyName');
  const emergencyPhone = at('emergencyPhone');
  const tags = at('tags');

  return {
    firstName: at('firstName'),
    lastName: at('lastName'),
    docId: at('docId'),
    phone: at('phone'),
    email: at('email'),
    birthDate: at('birthDate'),
    // El contacto de emergencia necesita las dos celdas: uno solo no sirve para
    // llamar a nadie, así que se ignora en vez de guardarse a medias.
    ...(emergencyName !== undefined && emergencyPhone !== undefined
      ? { emergencyContact: { fullName: emergencyName, phone: emergencyPhone } }
      : {}),
    ...(tags === undefined ? {} : { tags: tags.split(/[|;]/).map((tag) => tag.trim()) }),
  };
}

/** E11000 de Mongo. Se mira el código, no el mensaje, que cambia entre versiones. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/** Zod deja `undefined` en los opcionales; un `$set` con `undefined` borra el campo. */
function withoutUndefined(row: MemberImportRow): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}
