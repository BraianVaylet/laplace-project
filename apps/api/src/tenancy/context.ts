import { AsyncLocalStorage } from 'node:async_hooks';
import { AppError } from '../http/errors.js';

/**
 * El contexto del pedido en curso. El `tenantId` **es** el `organizationId`
 * (ADR-000) y sale siempre de la sesion: nunca del body ni de la query.
 */
export interface TenantContext {
  tenantId: string;
  /** Discriminador secundario. Nunca es la frontera de aislamiento (ADR-000). */
  venueId?: string;
  userId: string;
  requestId: string;
}

/**
 * Se usa `AsyncLocalStorage` y no un parametro porque el plugin de Mongoose
 * corre adentro del driver, lejos del handler de Hono, y necesita ver el tenant
 * para poder ser la segunda red de seguridad (ADR-000 regla 3). Pasarlo a mano
 * por cada capa seria justamente el tipo de disciplina que no queremos que sea
 * lo unico que separa a un centro de los datos de otro.
 */
const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * El contexto o un error. **Nunca** devuelve un resultado sin filtrar.
 *
 * Que esto lance significa que alguien consulto sin pasar por el middleware:
 * es un bug, se trata como incidente y no como error esperado. La alternativa
 * — seguir sin `tenantId` — es una fuga entre centros.
 */
export function requireTenant(): TenantContext {
  const context = storage.getStore();
  if (!context) {
    throw new AppError({
      code: 'LP-SYS-500-003',
      status: 500,
      message: 'Ocurrió un error. Compartí el código con soporte.',
      meta: { reason: 'consulta sin contexto de tenant' },
    });
  }

  return context;
}
