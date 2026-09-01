import type { FilterQuery, Model, SortOrder, UpdateQuery } from 'mongoose';
import { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../persistence/bson-date.js';
import { requireTenant } from './context.js';
import { decodeCursor, encodeCursor, keysetFilter, type SortDirection } from './cursor.js';
import { publicId, type IdEntity } from './public-id.js';

export interface Page<T> {
  items: T[];
  /** `null` cuando no hay mas paginas. */
  nextCursor: string | null;
}

export interface ListOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  /** Campo por el que se ordena y sobre el que corre el cursor. Debe estar indexado. */
  sortField?: string | undefined;
  direction?: SortDirection | undefined;
  /** Incluye los borrados logicamente. Solo para pantallas de auditoria. */
  includeDeleted?: boolean | undefined;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Primera capa de aislamiento del ADR-000 (regla 1): **todo query pasa por
 * aca** y el `tenantId` se inyecta sin que el llamador tenga que acordarse.
 * Prohibido usar el modelo de Mongoose directo en un controller.
 *
 * El plugin de Mongoose vuelve a inyectarlo por su cuenta. La duplicacion es a
 * proposito: si alguien se saltea el repositorio, la consulta sigue acotada.
 */
export abstract class TenantRepository<TDoc extends Record<string, unknown>> {
  protected constructor(
    protected readonly model: Model<TDoc>,
    private readonly entity: IdEntity,
  ) {}

  /** El filtro base: tenant del contexto y, salvo que se pida, sin borrados. */
  protected scope(filter: FilterQuery<TDoc> = {}, includeDeleted = false): Record<string, unknown> {
    const { tenantId } = requireTenant();
    const scoped: Record<string, unknown> = { ...filter, tenantId };
    if (!includeDeleted) scoped['deletedAt'] = null;

    return scoped;
  }

  async findByPublicId(id: string, includeDeleted = false): Promise<TDoc | null> {
    return this.model
      .findOne(this.scope({ publicId: id } as FilterQuery<TDoc>, includeDeleted))
      .setOptions({ withDeleted: includeDeleted })
      .lean<TDoc>()
      .exec();
  }

  async findOne(filter: FilterQuery<TDoc>, includeDeleted = false): Promise<TDoc | null> {
    return this.model
      .findOne(this.scope(filter, includeDeleted))
      .setOptions({ withDeleted: includeDeleted })
      .lean<TDoc>()
      .exec();
  }

  async count(filter: FilterQuery<TDoc> = {}): Promise<number> {
    return this.model.countDocuments(this.scope(filter)).exec();
  }

  /**
   * Listado paginado por cursor. Spec §5.0: **nunca `skip`** — en la pagina 200
   * de un listado, `skip` obliga a Mongo a leer y descartar todo lo anterior.
   */
  async list(filter: FilterQuery<TDoc> = {}, options: ListOptions = {}): Promise<Page<TDoc>> {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const sortField = options.sortField ?? 'createdAt';
    const direction: SortDirection = options.direction ?? 'desc';
    const position = options.cursor ? decodeCursor(options.cursor) : null;

    const query = {
      ...this.scope(filter, options.includeDeleted ?? false),
      ...keysetFilter(position, sortField, direction),
    };

    const order: SortOrder = direction === 'desc' ? -1 : 1;
    // Se pide uno de mas para saber si hay pagina siguiente sin contar el total.
    const found = await this.model
      .find(query)
      // La opcion viaja al plugin: sin esto, el plugin vuelve a filtrar los
      // borrados y `includeDeleted` no serviria para nada.
      .setOptions({ withDeleted: options.includeDeleted === true })
      .sort({ [sortField]: order, _id: order })
      .limit(limit + 1)
      .lean<TDoc[]>()
      .exec();

    const items = found.slice(0, limit);
    const hasMore = found.length > limit;
    const last = items.at(-1);

    return {
      items,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              value: cursorValueOf(last[sortField]),
              id: String(last['_id']),
            })
          : null,
    };
  }

  async create(data: Omit<Partial<TDoc>, 'tenantId' | 'publicId'>): Promise<TDoc> {
    const { tenantId, userId } = requireTenant();

    const created = await this.model.create({
      ...data,
      tenantId,
      publicId: publicId(this.entity),
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    } as unknown as TDoc);

    return created.toObject() as TDoc;
  }

  /**
   * Alta masiva. Existe porque `insertMany` sobre el modelo **no pasa por el
   * repositorio** y por lo tanto no genera `publicId`, que es obligatorio: la
   * importacion de un CSV de 143 socios (F1-05) tiene que entrar por aca.
   */
  async createMany(rows: Array<Omit<Partial<TDoc>, 'tenantId' | 'publicId'>>): Promise<number> {
    if (rows.length === 0) return 0;
    const { tenantId, userId } = requireTenant();

    const docs = rows.map((row) => ({
      ...row,
      tenantId,
      publicId: publicId(this.entity),
      createdBy: userId,
      updatedBy: userId,
      deletedAt: null,
    }));

    const inserted = await this.model.insertMany(docs as unknown as TDoc[]);
    return inserted.length;
  }

  async updateByPublicId(id: string, patch: UpdateQuery<TDoc>): Promise<TDoc | null> {
    const { userId } = requireTenant();

    return this.model
      .findOneAndUpdate(
        this.scope({ publicId: id } as FilterQuery<TDoc>),
        { ...patch, $set: { ...(patch.$set ?? {}), updatedBy: userId } },
        { new: true },
      )
      .lean<TDoc>()
      .exec();
  }

  /**
   * Borrado logico, que es el default de la spec §5.0. El hard delete existe
   * solo por pedido del titular de los datos y es una operacion aparte.
   */
  async softDeleteByPublicId(id: string): Promise<boolean> {
    const { userId } = requireTenant();

    const result = await this.model
      .updateOne(this.scope({ publicId: id } as FilterQuery<TDoc>), {
        $set: { deletedAt: toBsonDate(Temporal.Now.instant()), updatedBy: userId },
      })
      .exec();

    return result.modifiedCount === 1;
  }
}

function cursorValueOf(raw: unknown): string | number {
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}
