import { ObjectId, type Db } from 'mongodb';
import { isPlanId, type PlanId } from './catalog.js';
import type { OrganizationEntitlementSource } from './entitlements.js';
import type { OrganizationPlanReader } from './middleware.js';

/** Plan con el que arranca un centro recien creado (ADR-004, decision 5: trial de 14 dias). */
const TRIAL_PLAN: PlanId = 'basic';

/**
 * De donde sale el plan de una organizacion.
 *
 * 🔴 **La fuente de verdad es la suscripcion** (F1-25): es la fila que cambia
 * cuando alguien sube o baja de plan, y si los entitlements leyeran otra cosa,
 * cambiar de plan no cambiaria nada de lo que el centro puede hacer.
 *
 * El `metadata` de Better Auth queda como respaldo para las organizaciones
 * creadas antes de que existieran las suscripciones, y el ultimo recurso es el
 * plan del trial — el mas restrictivo. Ante la duda, de menos.
 */
export function createOrganizationPlanReader(db: Db): OrganizationPlanReader {
  return async (organizationId: string): Promise<OrganizationEntitlementSource | null> => {
    const suscripcion = await db
      .collection('subscriptions')
      .findOne<{ planId?: string }>({ organizationId });

    if (suscripcion?.planId !== undefined && isPlanId(suscripcion.planId)) {
      return { planId: suscripcion.planId };
    }

    /*
     * 🔴 Por `_id` y no por `id`: el adaptador de Mongo de Better Auth guarda
     * la organizacion con la clave de Mongo y **no expone un campo `id`**.
     * Consultar por `id` no encontraba nunca la fila, y cada centro caia al
     * plan del trial sin que nada fallara: un cliente de Max operando como
     * Basic, en silencio.
     */
    const org = await db
      .collection('organization')
      .findOne<{ metadata?: string | { planId?: string } }>(byId(organizationId) as never);

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

/**
 * El `_id` de la organizacion, en la forma que tiene guardada.
 *
 * Better Auth lo escribe como `ObjectId`, y su API lo devuelve como texto: si
 * se consulta con el texto tal cual, no encuentra nada. Con un id que no tiene
 * forma de `ObjectId` se consulta tal cual, que es como lo guardan los tests y
 * cualquier adaptador que use claves propias.
 */
function byId(organizationId: string): Record<string, unknown> {
  return ObjectId.isValid(organizationId)
    ? { $or: [{ _id: new ObjectId(organizationId) }, { _id: organizationId }] }
    : { _id: organizationId };
}
