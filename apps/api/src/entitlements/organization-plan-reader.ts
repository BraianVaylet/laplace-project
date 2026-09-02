import type { Db } from 'mongodb';
import { isPlanId, type PlanId } from './catalog.js';
import type { OrganizationEntitlementSource } from './entitlements.js';
import type { OrganizationPlanReader } from './middleware.js';

/** Plan con el que arranca un centro recien creado (ADR-004, decision 5: trial de 14 dias). */
const TRIAL_PLAN: PlanId = 'basic';

/**
 * De donde sale el plan de una organizacion.
 *
 * Hoy vive en `metadata` de la organizacion de Better Auth. Cuando entre F1-25
 * (Suscriptors + Suscriptions) la fuente pasa a ser el documento de suscripcion
 * con su `priceSnapshot`; el resto del codigo no se entera porque solo conoce
 * esta interfaz.
 */
export function createOrganizationPlanReader(db: Db): OrganizationPlanReader {
  return async (organizationId: string): Promise<OrganizationEntitlementSource | null> => {
    const org = await db
      .collection('organization')
      .findOne<{ metadata?: string | { planId?: string } }>({ id: organizationId });

    if (!org) return null;

    // Better Auth guarda `metadata` serializado. Un JSON roto no puede tumbar
    // el pedido: se cae al plan del trial, que es el mas restrictivo.
    const metadata = parseMetadata(org.metadata);
    const planId = metadata?.planId;

    return { planId: planId !== undefined && isPlanId(planId) ? planId : TRIAL_PLAN };
  };
}

function parseMetadata(raw: string | { planId?: string } | undefined): { planId?: string } | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string') return raw;

  try {
    return JSON.parse(raw) as { planId?: string };
  } catch {
    return null;
  }
}
