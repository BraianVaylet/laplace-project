import { describe, expect, it } from 'vitest';
import { createOrganizationPlanReader } from './organization-plan-reader.js';

/**
 * De donde sale el plan de un centro. Importa que un dato roto no escale
 * permisos: ante la duda, el plan mas restrictivo.
 */
/** Como la guarda Better Auth: con `_id`, sin campo `id`. */
type OrgRow = { _id: string; metadata?: string | { planId?: string } };
type SubRow = { organizationId: string; planId?: string };

/**
 * El `_id` que busca la consulta. El lector consulta con `$or` cuando el id
 * tiene forma de `ObjectId`, porque Better Auth lo guarda asi.
 */
function idOf(filter: { _id?: string; $or?: Array<{ _id: unknown }> }): unknown {
  return (
    filter._id ?? filter.$or?.map((clausula) => clausula._id).find((id) => typeof id === 'string')
  );
}

/**
 * Un `Db` de mentira con lo unico que el lector usa: `collection().findOne()`.
 * Distingue las dos colecciones porque el orden importa — la suscripcion manda
 * sobre el metadata.
 */
function fakeDb(rows: OrgRow[], subs: SubRow[] = []) {
  return {
    collection: (name: string) => ({
      findOne: (filter: { _id?: string; organizationId?: string; $or?: Array<{ _id: unknown }> }) =>
        Promise.resolve(
          name === 'subscriptions'
            ? (subs.find((row) => row.organizationId === filter.organizationId) ?? null)
            : (rows.find((row) => row._id === idOf(filter)) ?? null),
        ),
    }),
  } as unknown as Parameters<typeof createOrganizationPlanReader>[0];
}

describe('lector del plan de la organizacion', () => {
  it('lee el planId del metadata serializado de Better Auth', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ _id: 'org_1', metadata: JSON.stringify({ planId: 'pro' }) }]),
    );

    expect(await read('org_1')).toEqual({ planId: 'pro' });
  });

  it('tambien lo lee si el driver ya lo devolvio como objeto', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ _id: 'org_1', metadata: { planId: 'max' } }]),
    );

    expect(await read('org_1')).toEqual({ planId: 'max' });
  });

  it('una organizacion sin plan arranca en el del trial (ADR-004, decision 5)', async () => {
    const read = createOrganizationPlanReader(fakeDb([{ _id: 'org_1' }]));

    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });

  it('un plan inventado no habilita nada: cae al mas restrictivo', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ _id: 'org_1', metadata: JSON.stringify({ planId: 'enterprise_ilimitado' }) }]),
    );

    // Si esto devolviera el valor tal cual, `planFor` explotaria en runtime y el
    // centro entero se quedaria sin poder operar por un dato mal escrito.
    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });

  it('un metadata con JSON roto tampoco tumba el pedido', async () => {
    const read = createOrganizationPlanReader(fakeDb([{ _id: 'org_1', metadata: '{planId: pro' }]));

    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });

  it('una organizacion que no existe devuelve null, no un plan por default', async () => {
    const read = createOrganizationPlanReader(fakeDb([]));

    // El default silencioso acá seria peor: le daria entitlements a un
    // organizationId que ya no existe.
    expect(await read('org_fantasma')).toBeNull();
  });
});

describe('la suscripcion manda sobre el metadata (F1-25)', () => {
  it('🔴 lee el plan de la suscripcion, que es la que cambia al cambiar de plan', async () => {
    /*
     * Si los entitlements leyeran el metadata, cambiar de plan no cambiaria
     * nada de lo que el centro puede hacer: el cambio quedaria escrito en un
     * lado y los permisos en otro.
     */
    const read = createOrganizationPlanReader(
      fakeDb(
        [{ _id: 'org_1', metadata: JSON.stringify({ planId: 'basic' }) }],
        [{ organizationId: 'org_1', planId: 'max' }],
      ),
    );

    expect(await read('org_1')).toEqual({ planId: 'max' });
  });

  it('sin suscripcion, cae al metadata: las cuentas viejas siguen andando', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ _id: 'org_1', metadata: JSON.stringify({ planId: 'pro' }) }], []),
    );

    expect(await read('org_1')).toEqual({ planId: 'pro' });
  });

  it('una suscripcion con un plan que no existe no escala permisos', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ _id: 'org_1' }], [{ organizationId: 'org_1', planId: 'inventado' }]),
    );

    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });
});
