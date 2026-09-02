import { describe, expect, it } from 'vitest';
import { createOrganizationPlanReader } from './organization-plan-reader.js';

/**
 * De donde sale el plan de un centro. Importa que un dato roto no escale
 * permisos: ante la duda, el plan mas restrictivo.
 */
type OrgRow = { id: string; metadata?: string | { planId?: string } };

/** Un `Db` de mentira con lo unico que el lector usa: `collection().findOne()`. */
function fakeDb(rows: OrgRow[]) {
  return {
    collection: () => ({
      findOne: (filter: { id: string }) =>
        Promise.resolve(rows.find((row) => row.id === filter.id) ?? null),
    }),
  } as unknown as Parameters<typeof createOrganizationPlanReader>[0];
}

describe('lector del plan de la organizacion', () => {
  it('lee el planId del metadata serializado de Better Auth', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ id: 'org_1', metadata: JSON.stringify({ planId: 'pro' }) }]),
    );

    expect(await read('org_1')).toEqual({ planId: 'pro' });
  });

  it('tambien lo lee si el driver ya lo devolvio como objeto', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ id: 'org_1', metadata: { planId: 'max' } }]),
    );

    expect(await read('org_1')).toEqual({ planId: 'max' });
  });

  it('una organizacion sin plan arranca en el del trial (ADR-004, decision 5)', async () => {
    const read = createOrganizationPlanReader(fakeDb([{ id: 'org_1' }]));

    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });

  it('un plan inventado no habilita nada: cae al mas restrictivo', async () => {
    const read = createOrganizationPlanReader(
      fakeDb([{ id: 'org_1', metadata: JSON.stringify({ planId: 'enterprise_ilimitado' }) }]),
    );

    // Si esto devolviera el valor tal cual, `planFor` explotaria en runtime y el
    // centro entero se quedaria sin poder operar por un dato mal escrito.
    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });

  it('un metadata con JSON roto tampoco tumba el pedido', async () => {
    const read = createOrganizationPlanReader(fakeDb([{ id: 'org_1', metadata: '{planId: pro' }]));

    expect(await read('org_1')).toEqual({ planId: 'basic' });
  });

  it('una organizacion que no existe devuelve null, no un plan por default', async () => {
    const read = createOrganizationPlanReader(fakeDb([]));

    // El default silencioso acá seria peor: le daria entitlements a un
    // organizationId que ya no existe.
    expect(await read('org_fantasma')).toBeNull();
  });
});
