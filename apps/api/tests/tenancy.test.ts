import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Schema, type Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { AppError } from '../src/http/errors.js';
import { runWithTenant, type TenantContext } from '../src/tenancy/context.js';
import { baseFieldsPlugin, tenantPlugin } from '../src/tenancy/plugin.js';
import { TenantRepository } from '../src/tenancy/repository.js';

/**
 * F0-04. Las tres capas del ADR-000 contra Mongo real. Lo que se prueba no es
 * que el codigo feliz funcione, sino que **el tenant A no pueda tocar nada del
 * tenant B**, ni con un ID valido en la mano.
 */
let replSet: MongoMemoryReplSet;

const BOX_TORO: TenantContext = {
  tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  userId: 'usr_braian',
  requestId: 'req-1',
};
const GYM_BLACK: TenantContext = {
  tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  userId: 'usr_lucia',
  requestId: 'req-2',
};

interface WidgetDoc extends Record<string, unknown> {
  name: string;
  order: number;
}

const widgetSchema = new Schema<WidgetDoc>({
  name: { type: String, required: true },
  order: { type: Number, required: true, default: 0 },
});
widgetSchema.plugin(tenantPlugin);
widgetSchema.plugin(baseFieldsPlugin);

let Widget: Model<WidgetDoc>;

class WidgetRepository extends TenantRepository<WidgetDoc> {
  constructor(model: Model<WidgetDoc>) {
    super(model, 'member');
  }
}

let repo: WidgetRepository;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri(), { dbName: 'laplace_tenancy_test' });

  Widget = mongoose.model<WidgetDoc>('Widget', widgetSchema);
  repo = new WidgetRepository(Widget);
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  // Por el driver crudo a proposito: el plugin exige contexto y aca no hay uno.
  await mongoose.connection.db?.collection('widgets').deleteMany({});
});

/** Siembra un documento en cada centro y devuelve los dos. */
async function seedBoth() {
  const mine = await runWithTenant(BOX_TORO, () => repo.create({ name: 'Rack 1', order: 1 }));
  const theirs = await runWithTenant(GYM_BLACK, () => repo.create({ name: 'Reformer', order: 1 }));
  return { mine, theirs };
}

describe('capa 1 — el repositorio inyecta el tenant', () => {
  it('crear estampa el tenant, la autoria y el id publico', async () => {
    const doc = await runWithTenant(BOX_TORO, () => repo.create({ name: 'Rack 1', order: 1 }));

    expect(doc['tenantId']).toBe(BOX_TORO.tenantId);
    expect(doc['createdBy']).toBe(BOX_TORO.userId);
    expect(doc['updatedBy']).toBe(BOX_TORO.userId);
    expect(doc['deletedAt']).toBeNull();
    expect(String(doc['publicId'])).toMatch(/^mem_/);
    expect(doc['createdAt']).toBeDefined();
  });

  it('listar solo devuelve lo del centro activo', async () => {
    await seedBoth();

    const boxToro = await runWithTenant(BOX_TORO, () => repo.list());
    const gymBlack = await runWithTenant(GYM_BLACK, () => repo.list());

    expect(boxToro.items).toHaveLength(1);
    expect(boxToro.items[0]?.name).toBe('Rack 1');
    expect(gymBlack.items).toHaveLength(1);
    expect(gymBlack.items[0]?.name).toBe('Reformer');
  });

  it('contar cuenta solo lo propio', async () => {
    await seedBoth();

    expect(await runWithTenant(BOX_TORO, () => repo.count())).toBe(1);
  });
});

describe('capa 1 — aislamiento con un ID valido en la mano', () => {
  it('buscar por el publicId del otro centro devuelve null, no el documento', async () => {
    const { theirs } = await seedBoth();

    const found = await runWithTenant(BOX_TORO, () =>
      repo.findByPublicId(String(theirs['publicId'])),
    );

    expect(found).toBeNull();
  });

  it('actualizar el documento del otro centro no hace nada', async () => {
    const { theirs } = await seedBoth();

    const updated = await runWithTenant(BOX_TORO, () =>
      repo.updateByPublicId(String(theirs['publicId']), { $set: { name: 'Hackeado' } }),
    );

    expect(updated).toBeNull();

    const intact = await runWithTenant(GYM_BLACK, () =>
      repo.findByPublicId(String(theirs['publicId'])),
    );
    expect(intact?.name).toBe('Reformer');
  });

  it('borrar el documento del otro centro no hace nada', async () => {
    const { theirs } = await seedBoth();

    const deleted = await runWithTenant(BOX_TORO, () =>
      repo.softDeleteByPublicId(String(theirs['publicId'])),
    );

    expect(deleted).toBe(false);
    expect(
      await runWithTenant(GYM_BLACK, () => repo.findByPublicId(String(theirs['publicId']))),
    ).not.toBeNull();
  });

  it('un filtro que trae un tenantId ajeno no puede sobreescribir el del contexto', async () => {
    await seedBoth();

    const leaked = await runWithTenant(BOX_TORO, () =>
      repo.findOne({ tenantId: GYM_BLACK.tenantId, name: 'Reformer' } as never),
    );

    expect(leaked).toBeNull();
  });
});

describe('capa 2 — el plugin como red de seguridad', () => {
  it('el modelo usado directo, sin repositorio, igual queda acotado al tenant', async () => {
    await seedBoth();

    const found = await runWithTenant(BOX_TORO, () => Widget.find({}).lean().exec());

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('Rack 1');
  });

  it('pedir explicitamente el tenant de otro LANZA: es un bug, no un listado vacio', async () => {
    await seedBoth();

    await expect(
      runWithTenant(BOX_TORO, () => Widget.find({ tenantId: GYM_BLACK.tenantId }).lean().exec()),
    ).rejects.toThrowError(AppError);

    try {
      await runWithTenant(BOX_TORO, () =>
        Widget.find({ tenantId: GYM_BLACK.tenantId }).lean().exec(),
      );
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SYS-500-003');
    }
  });

  it('una agregacion tambien queda acotada: si no, las metricas leen todo', async () => {
    await seedBoth();

    const rows = await runWithTenant(BOX_TORO, () =>
      Widget.aggregate([{ $group: { _id: null, total: { $sum: 1 } } }]).exec(),
    );

    expect(rows[0]?.total).toBe(1);
  });

  it('sin contexto FALLA con LP-SYS-500-003: fallar es lo correcto, devolver todo es la catastrofe', async () => {
    await seedBoth();

    await expect(Widget.find({}).lean().exec()).rejects.toThrowError(AppError);

    try {
      await Widget.find({}).lean().exec();
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SYS-500-003');
    }
  });

  it('guardar sin contexto tampoco pasa', async () => {
    await expect(new Widget({ name: 'Huerfano', order: 1 }).save()).rejects.toThrowError(AppError);
  });
});

describe('capa 2 — la salida explicita `skipTenantScope`', () => {
  /*
   * F1-04 la necesita: el canje de un codigo de invitacion ocurre ANTES de que
   * la persona pertenezca a ningun centro, asi que el tenant sale del codigo.
   * Es la unica excepcion, y estos tests existen para que siga siendo unica y
   * para que su alcance quede escrito.
   */
  it('sin contexto de tenant, el plugin corta: es lo normal', async () => {
    await seedBoth();

    await expect(Widget.find({}).lean().exec()).rejects.toThrowError(AppError);
  });

  it('con la salida explicita, la consulta corre sin tenant', async () => {
    await seedBoth();

    const found = await Widget.find({}).setOptions({ skipTenantScope: true }).lean().exec();

    // Ve los dos centros: por eso el filtro tiene que acotar por si mismo, como
    // el `code` unico global de un codigo de invitacion.
    expect(found).toHaveLength(2);
  });

  it('la salida es por consulta, no un interruptor global', async () => {
    await seedBoth();

    await Widget.find({}).setOptions({ skipTenantScope: true }).lean().exec();

    // La consulta siguiente vuelve a exigir contexto: si la salida se pegara al
    // modelo, un solo uso dejaria abierta la coleccion para todo el proceso.
    await expect(Widget.find({}).lean().exec()).rejects.toThrowError(AppError);
  });

  it('dentro de un contexto de tenant, la salida sigue mandando', async () => {
    await seedBoth();

    const found = await runWithTenant(BOX_TORO, () =>
      Widget.find({}).setOptions({ skipTenantScope: true }).lean().exec(),
    );

    // Es lo que hace que sea peligrosa y por lo que tiene que ser greppable:
    // usarla adentro de un pedido con tenant devuelve datos de otros centros.
    expect(found).toHaveLength(2);
  });
});

describe('borrado logico', () => {
  it('no borra de verdad: el documento sigue en la coleccion', async () => {
    const { mine } = await seedBoth();

    await runWithTenant(BOX_TORO, () => repo.softDeleteByPublicId(String(mine['publicId'])));

    const raw = await mongoose.connection.db
      ?.collection('widgets')
      .findOne({ publicId: mine['publicId'] });
    expect(raw).not.toBeNull();
    expect(raw?.['deletedAt']).not.toBeNull();
  });

  it('lo borrado no aparece en los listados', async () => {
    const { mine } = await seedBoth();

    await runWithTenant(BOX_TORO, () => repo.softDeleteByPublicId(String(mine['publicId'])));

    const page = await runWithTenant(BOX_TORO, () => repo.list());
    expect(page.items).toHaveLength(0);
    expect(await runWithTenant(BOX_TORO, () => repo.count())).toBe(0);
  });

  it('se puede pedir explicitamente, para auditoria', async () => {
    const { mine } = await seedBoth();
    await runWithTenant(BOX_TORO, () => repo.softDeleteByPublicId(String(mine['publicId'])));

    const page = await runWithTenant(BOX_TORO, () => repo.list({}, { includeDeleted: true }));

    expect(page.items).toHaveLength(1);
  });
});

describe('paginacion por cursor', () => {
  beforeEach(async () => {
    await runWithTenant(BOX_TORO, async () => {
      for (let i = 1; i <= 25; i++) await repo.create({ name: `w${i}`, order: i });
    });
    await runWithTenant(GYM_BLACK, () => repo.create({ name: 'ajeno', order: 999 }));
  });

  it('devuelve la pagina pedida y un cursor cuando hay mas', async () => {
    const page = await runWithTenant(BOX_TORO, () =>
      repo.list({}, { limit: 10, sortField: 'order', direction: 'asc' }),
    );

    expect(page.items).toHaveLength(10);
    expect(page.items[0]?.order).toBe(1);
    expect(page.nextCursor).not.toBeNull();
  });

  it('recorre todo sin repetir ni perder documentos', async () => {
    const seen: number[] = [];
    let cursor: string | null = null;

    do {
      const page = await runWithTenant(BOX_TORO, () =>
        repo.list(
          {},
          { limit: 7, sortField: 'order', direction: 'asc', ...(cursor ? { cursor } : {}) },
        ),
      );
      seen.push(...page.items.map((i) => i.order));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(seen).size).toBe(25);
  });

  it('la ultima pagina no devuelve cursor', async () => {
    const page = await runWithTenant(BOX_TORO, () =>
      repo.list({}, { limit: 100, sortField: 'order', direction: 'asc' }),
    );

    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toBeNull();
  });

  it('un cursor de un centro no filtra documentos del otro', async () => {
    const first = await runWithTenant(BOX_TORO, () =>
      repo.list({}, { limit: 5, sortField: 'order', direction: 'asc' }),
    );

    const withForeignCursor = await runWithTenant(GYM_BLACK, () =>
      repo.list(
        {},
        {
          limit: 100,
          sortField: 'order',
          direction: 'asc',
          cursor: first.nextCursor as string,
        },
      ),
    );

    expect(withForeignCursor.items.every((i) => i.name === 'ajeno' || i.name === undefined)).toBe(
      true,
    );
    expect(withForeignCursor.items.some((i) => i.name?.startsWith('w'))).toBe(false);
  });

  it('el limite tiene techo: pedir 10000 no baja la coleccion entera', async () => {
    const page = await runWithTenant(BOX_TORO, () => repo.list({}, { limit: 10_000 }));

    expect(page.items.length).toBeLessThanOrEqual(100);
  });
});
