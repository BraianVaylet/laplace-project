import type { Aggregate, Schema } from 'mongoose';
import { AppError } from '../http/errors.js';
import { currentTenant, requireTenant } from './context.js';

/**
 * Segunda red de seguridad del ADR-000 (regla 3). La primera es el repositorio,
 * que inyecta el `tenantId` a proposito; esta es la que actua cuando alguien se
 * saltea el repositorio.
 *
 * **Falla ruidosamente si no hay contexto.** Es deliberado: una consulta sin
 * `tenantId` que igual devuelve resultados es una fuga entre centros, y prefiero
 * un 500 con su codigo a un listado con los socios de otro box.
 */
export function tenantPlugin(schema: Schema): void {
  schema.add({
    tenantId: { type: String, required: true, index: true },
  });

  /** Lectura: `find`, `findOne`, `findOneAndUpdate`, `findOneAndDelete`, `count`… */
  schema.pre(/^find/, function scopeReads(this: SchemaQuery) {
    applyScope(this);
  });

  schema.pre(/^count/, function scopeCounts(this: SchemaQuery) {
    applyScope(this);
  });

  schema.pre(/^update/, function scopeUpdates(this: SchemaQuery) {
    applyScope(this);
    stampUpdatedBy(this);
  });

  schema.pre(/^delete/, function scopeDeletes(this: SchemaQuery) {
    applyScope(this);
  });

  /**
   * En `validate` y no en `save`: Mongoose valida antes de guardar, asi que con
   * el hook en `save` el `required: true` de `tenantId` ganaba de mano y el
   * error que salia era un ValidationError sin codigo, no nuestro AppError.
   */
  schema.pre('validate', function stampTenantOnSave(this: SchemaDoc) {
    const context = requireTenant();
    this['tenantId'] ??= context.tenantId;

    if (this.isNew) this['createdBy'] ??= context.userId;
    this['updatedBy'] = context.userId;
  });

  schema.pre('insertMany', function stampTenantOnInsertMany(next, docs: Record<string, unknown>[]) {
    const context = requireTenant();

    for (const doc of docs) {
      doc['tenantId'] ??= context.tenantId;
      doc['createdBy'] ??= context.userId;
      doc['updatedBy'] ??= context.userId;
    }

    next();
  });

  /**
   * `aggregate` no pasa por los hooks de query: si no se cubre, una agregacion
   * de metricas lee la coleccion entera. Se le antepone un `$match`.
   */
  schema.pre('aggregate', function scopeAggregations(this: Aggregate<unknown>) {
    const context = requireTenant();
    this.pipeline().unshift({ $match: { tenantId: context.tenantId } });
  });
}

/** Marca de tiempo, autoria y borrado logico. Spec §5.2.1. */
export function baseFieldsPlugin(schema: Schema): void {
  schema.add({
    /** Identificador publico con prefijo, para soporte (§5.2.1). */
    publicId: { type: String, required: true, unique: true, index: true },
    createdBy: { type: String, required: false },
    updatedBy: { type: String, required: false },
    /** Soft delete por default (§5.0). El hard delete es una operacion aparte. */
    deletedAt: { type: Date, default: null, index: true },
  });

  schema.set('timestamps', true);
}

// ── Internals ──────────────────────────────────────────────────────────────

interface SchemaQuery {
  getFilter(): Record<string, unknown>;
  getOptions(): Record<string, unknown>;
  setQuery(filter: Record<string, unknown>): unknown;
  set(path: string, value: unknown): unknown;
}

interface SchemaDoc {
  isNew: boolean;
  [key: string]: unknown;
}

/**
 * Agrega el `tenantId` del contexto y, salvo que se pida lo contrario, excluye
 * lo borrado logicamente.
 */
function applyScope(query: SchemaQuery): void {
  const context = requireTenant();
  const filter = query.getFilter();
  const options = query.getOptions();

  /**
   * Si el filtro nombra un tenant distinto al del contexto, es un bug del
   * llamador. Se lanza en vez de reescribirlo: reescribir en silencio devuelve
   * datos que nadie pidio y esconde el error hasta que aparece en produccion.
   */
  const declared = filter['tenantId'];
  if (typeof declared === 'string' && declared !== context.tenantId) {
    throw new AppError({
      code: 'LP-SYS-500-003',
      status: 500,
      message: 'Ocurrió un error. Compartí el código con soporte.',
      meta: { reason: 'consulta con un tenantId distinto al del contexto' },
    });
  }

  const scoped: Record<string, unknown> = { ...filter, tenantId: context.tenantId };

  if (options['withDeleted'] !== true && filter['deletedAt'] === undefined) {
    scoped['deletedAt'] = null;
  }

  query.setQuery(scoped);
}

function stampUpdatedBy(query: SchemaQuery): void {
  const context = currentTenant();
  if (context) query.set('updatedBy', context.userId);
}
