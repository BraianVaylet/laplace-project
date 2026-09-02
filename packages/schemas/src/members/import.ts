import { z } from 'zod';
import { contactSchema, docIdSchema, plainDateSchema } from './index.js';

/**
 * Importación masiva de socios (§2.1.7). Es la fricción número 1 para cambiar de
 * plataforma: si importar duele, el centro no migra.
 *
 * El flujo tiene dos pasos a propósito: **previsualizar y después confirmar.**
 * Un import que escribe mientras valida deja el padrón a medio migrar y sin
 * forma de saber qué entró.
 */

/**
 * Alias de columna aceptados, ya normalizados (sin acentos, sin espacios, en
 * minúscula). El centro exporta de Excel o de un competidor: exigir un
 * encabezado exacto es pedirle que edite el archivo antes de poder probarlo.
 */
export const IMPORT_COLUMN_ALIASES: Record<string, readonly string[]> = {
  firstName: ['nombre', 'nombres', 'firstname'],
  lastName: ['apellido', 'apellidos', 'lastname'],
  docId: ['documento', 'dni', 'doc', 'nrodocumento', 'documentodeidentidad'],
  phone: ['telefono', 'celular', 'tel', 'phone', 'movil'],
  email: ['email', 'correo', 'mail', 'correoelectronico'],
  birthDate: ['fechadenacimiento', 'fechanacimiento', 'nacimiento', 'birthdate'],
  tags: ['etiquetas', 'tags'],
  emergencyName: ['contactodeemergencia', 'emergencia', 'contactoemergencia'],
  emergencyPhone: ['telefonodeemergencia', 'telefonoemergencia', 'telemergencia'],
};

/**
 * Fecha como sale de un Excel en es-AR (`12/04/1999`) o como la escribe un
 * sistema (`1999-04-12`). Aceptar solo la segunda haría fallar el archivo del
 * 90% de los centros por un motivo que no es del centro.
 */
export const importDateSchema = z
  .string()
  .trim()
  .transform((value) => {
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (!slash) return value;

    const [, day, month, year] = slash as unknown as [string, string, string, string];

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  })
  .pipe(plainDateSchema);

/**
 * Una fila del archivo, ya mapeada a campos. `venueIds` no está: la sede la
 * elige el SMU una vez para todo el archivo, no columna por columna.
 */
export const memberImportRowSchema = z.object({
  firstName: z.string().trim().min(2, 'Cargá el nombre.').max(60),
  lastName: z.string().trim().min(2, 'Cargá el apellido.').max(60),
  docId: docIdSchema.optional(),
  phone: z.string().trim().min(6, 'El teléfono parece incompleto.').max(30).optional(),
  email: z.string().trim().toLowerCase().email('Revisá el email.').optional(),
  birthDate: importDateSchema.optional(),
  emergencyContact: contactSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
});

export type MemberImportRow = z.infer<typeof memberImportRowSchema>;

/** Qué hacer con las filas cuyo documento ya existe en el centro. */
export const duplicatePolicySchema = z.enum(['skip', 'update']);
export type DuplicatePolicy = z.infer<typeof duplicatePolicySchema>;

export const previewImportSchema = z.object({
  /** El contenido del archivo, tal cual. */
  csv: z.string().min(1, 'Subí un archivo.'),
});

export type PreviewImportInput = z.infer<typeof previewImportSchema>;

/** Un error de una celda: qué columna y por qué, en español. */
export const importIssueSchema = z.object({
  column: z.string(),
  message: z.string(),
});

export const IMPORT_ROW_STATES = ['new', 'duplicate', 'invalid'] as const;
export const importRowStatusSchema = z.enum(IMPORT_ROW_STATES);
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;

export const previewRowSchema = z.object({
  /** Número de fila **en el archivo**, con el encabezado contado: la fila 1 es el encabezado. */
  rowNumber: z.number().int(),
  status: importRowStatusSchema,
  /** Los datos ya mapeados y normalizados. `null` si la fila no se pudo interpretar. */
  data: memberImportRowSchema.nullable(),
  issues: z.array(importIssueSchema),
  /** Si es duplicado, a quién pisa. */
  existingMemberId: z.string().optional(),
});

export const previewResultSchema = z.object({
  /** Columnas del archivo que no se reconocieron. Se ignoran, pero se avisan. */
  ignoredColumns: z.array(z.string()),
  rows: z.array(previewRowSchema),
  summary: z.object({
    total: z.number().int(),
    new: z.number().int(),
    duplicate: z.number().int(),
    invalid: z.number().int(),
  }),
  /** Cuántos entran en el plan y cuántos exceden, contando los que se crearían. */
  planCheck: z.object({
    limit: z.number().int().nullable(),
    current: z.number().int(),
    wouldCreate: z.number().int(),
    exceeds: z.number().int(),
  }),
});

export type PreviewResult = z.infer<typeof previewResultSchema>;

export const confirmImportSchema = z.object({
  /** La sede a la que entran todos los socios del archivo. */
  venueIds: z.array(z.string()).min(1, 'Elegí al menos una sede.').max(20),
  onDuplicate: duplicatePolicySchema.default('skip'),
  rows: z.array(memberImportRowSchema).min(1, 'No hay filas para importar.').max(5000),
});

export type ConfirmImportInput = z.infer<typeof confirmImportSchema>;

/** El resumen que queda al terminar, descargable. */
export const importResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  /** Qué se salteó y por qué, fila por fila. */
  details: z.array(
    z.object({
      rowNumber: z.number().int(),
      action: z.enum(['created', 'updated', 'skipped']),
      reason: z.string().optional(),
      memberId: z.string().optional(),
    }),
  ),
});

export type ImportResult = z.infer<typeof importResultSchema>;
