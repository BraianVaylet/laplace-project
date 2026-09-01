import type { Context, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { OrgEnv } from '../auth/organization.js';
import { AppError } from '../http/errors.js';
import type { FeatureName, LimitName, ModuleName, PlanId } from './catalog.js';
import {
  LIMIT_LABELS,
  hasFeature,
  hasModule,
  limitStatus,
  resolveEntitlements,
  type Entitlements,
  type OrganizationEntitlementSource,
} from './entitlements.js';

export type EntitlementsEnv = OrgEnv & { Variables: { entitlements: Entitlements } };

/** De donde salen el plan y los overrides de una organizacion. */
export type OrganizationPlanReader = (
  organizationId: string,
) => Promise<OrganizationEntitlementSource | null>;

export interface EntitlementsLoader {
  load(organizationId: string): Promise<Entitlements>;
  /** Se llama al cambiar de plan: sin esto, el centro sigue con el anterior. */
  invalidate(organizationId: string): void;
  invalidateAll(): void;
}

/**
 * Cache de entitlements por organizacion (§2.1.22). Se resuelven en cada
 * peticion, asi que sin cache serian una consulta extra por request.
 */
export function createEntitlementsLoader(read: OrganizationPlanReader): EntitlementsLoader {
  const cache = new Map<string, Entitlements>();

  return {
    async load(organizationId) {
      const cached = cache.get(organizationId);
      if (cached) return cached;

      const source = await read(organizationId);
      if (!source) {
        throw new AppError({
          code: 'LP-SUSC-422-001',
          status: 422,
          message: 'No pudimos identificar tu centro.',
          meta: { organizationId },
        });
      }

      const resolved = resolveEntitlements(source);
      cache.set(organizationId, resolved);
      return resolved;
    },

    invalidate(organizationId) {
      cache.delete(organizationId);
    },

    invalidateAll() {
      cache.clear();
    },
  };
}

/** Deja los entitlements del centro activo en el contexto. Va despues de `requireOrganization`. */
export function entitlementsContext(loader: EntitlementsLoader): MiddlewareHandler {
  return createMiddleware<EntitlementsEnv>(async (c, next) => {
    const org = c.get('org');
    c.set('entitlements', await loader.load(org.organizationId));
    await next();
  });
}

function upgradeAction(planId: PlanId): string {
  return planId === 'max'
    ? 'Escribinos para ampliar tu cuenta.'
    : 'Podés pasar a un plan superior.';
}

/**
 * El modulo tiene que estar en el plan. **El enforcement va aca, en el backend**
 * (§2.1.22): ocultar un boton en la UI no es una restriccion.
 */
export function requireModule(module: ModuleName): MiddlewareHandler {
  return createMiddleware<EntitlementsEnv>(async (c, next) => {
    const entitlements = c.get('entitlements');

    if (!hasModule(entitlements, module)) {
      throw new AppError({
        code: 'LP-ENTL-403-002',
        status: 403,
        message: `El módulo ${module} no está incluido en tu plan ${entitlements.planName}.`,
        action: upgradeAction(entitlements.planId),
        meta: { module, planId: entitlements.planId },
      });
    }

    await next();
  });
}

export function requireFeature(feature: FeatureName): MiddlewareHandler {
  return createMiddleware<EntitlementsEnv>(async (c, next) => {
    const entitlements = c.get('entitlements');

    if (!hasFeature(entitlements, feature)) {
      throw new AppError({
        code: 'LP-ENTL-403-003',
        status: 403,
        message: 'Esta función no está incluida en tu plan.',
        action: upgradeAction(entitlements.planId),
        meta: { feature, planId: entitlements.planId },
      });
    }

    await next();
  });
}

/** Cuenta cuantos recursos consume hoy el centro. */
export type UsageCounter = (c: Context) => Promise<number>;

export interface LimitGuardOptions {
  /** Se llama cuando el uso cruza el 80% (§2.1.22). */
  onWarning?: ((info: { limit: LimitName; current: number; max: number }) => void) | undefined;
}

/**
 * Corta antes de crear el recurso que excederia el limite.
 *
 * El contador que se le pasa **debe contar activos, no historicos**: archivar a
 * los socios que se fueron no puede costar plata (§2.2.1).
 */
export function requireWithinLimit(
  limit: LimitName,
  count: UsageCounter,
  options: LimitGuardOptions = {},
): MiddlewareHandler {
  return createMiddleware<EntitlementsEnv>(async (c, next) => {
    const entitlements = c.get('entitlements');
    const status = limitStatus(entitlements, limit, await count(c));

    if (!status.allowsOneMore) {
      throw new AppError({
        code: 'LP-ENTL-403-001',
        // El mensaje dice QUE excede y CUANTO: un limite sin numero concreto
        // obliga al usuario a adivinar.
        status: 403,
        message: `Alcanzaste el máximo de ${status.limit} ${LIMIT_LABELS[limit]} de tu plan ${entitlements.planName}.`,
        action: upgradeAction(entitlements.planId),
        meta: { limit, current: status.current, max: status.limit, planId: entitlements.planId },
      });
    }

    if (status.atWarning && status.limit !== null) {
      options.onWarning?.({ limit, current: status.current, max: status.limit });
    }

    await next();
  });
}
