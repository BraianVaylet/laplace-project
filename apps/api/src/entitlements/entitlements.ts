import {
  planFor,
  type FeatureName,
  type LimitName,
  type ModuleName,
  type PlanDefinition,
  type PlanId,
  type PlanLimits,
} from './catalog.js';

/**
 * Los entitlements efectivos de una organizacion: lo del plan, con los
 * overrides del suscriptor aplicados encima (planes VIP y custom, §2.1.4).
 */
export interface Entitlements {
  planId: PlanId;
  planName: string;
  modules: ReadonlySet<ModuleName>;
  features: ReadonlySet<FeatureName>;
  limits: PlanLimits;
}

export interface OrganizationEntitlementSource {
  planId: PlanId;
  /** Override por suscriptor. Solo los limites que se pisan. */
  planLimits?: Partial<PlanLimits> | undefined;
  extraFeatures?: readonly FeatureName[] | undefined;
  extraModules?: readonly ModuleName[] | undefined;
}

export function resolveEntitlements(source: OrganizationEntitlementSource): Entitlements {
  const plan: PlanDefinition = planFor(source.planId);

  return {
    planId: plan.id,
    planName: plan.name,
    modules: new Set([...plan.modules, ...(source.extraModules ?? [])]),
    features: new Set([...plan.features, ...(source.extraFeatures ?? [])]),
    limits: { ...plan.limits, ...(source.planLimits ?? {}) },
  };
}

export function hasModule(entitlements: Entitlements, module: ModuleName): boolean {
  return entitlements.modules.has(module);
}

export function hasFeature(entitlements: Entitlements, feature: FeatureName): boolean {
  return entitlements.features.has(feature);
}

/** Umbral de aviso de §2.1.22: se avisa al 80% y otra vez al 100%. */
export const WARNING_THRESHOLD = 0.8;

export interface LimitStatus {
  limit: number | null;
  current: number;
  /** `true` si todavia entra uno mas. */
  allowsOneMore: boolean;
  /** Porcentaje de uso. `0` cuando no hay limite. */
  usedRatio: number;
  atWarning: boolean;
  atLimit: boolean;
}

/**
 * El estado de un limite. `current` **cuenta activos, no historicos**: archivar
 * a los socios que se fueron no puede costar plata (§2.2.1). Quien llama es
 * responsable de contar bien; el conteo no vive aca.
 */
export function limitStatus(
  entitlements: Entitlements,
  limit: LimitName,
  current: number,
): LimitStatus {
  const max = entitlements.limits[limit];

  if (max === null) {
    return {
      limit: null,
      current,
      allowsOneMore: true,
      usedRatio: 0,
      atWarning: false,
      atLimit: false,
    };
  }

  const usedRatio = max === 0 ? 1 : current / max;

  return {
    limit: max,
    current,
    allowsOneMore: current < max,
    usedRatio,
    atWarning: usedRatio >= WARNING_THRESHOLD && current < max,
    atLimit: current >= max,
  };
}

export type Usage = Record<LimitName, number>;

export interface DowngradeViolation {
  limit: LimitName;
  current: number;
  max: number;
}

export interface DowngradeCheck {
  allowed: boolean;
  violations: DowngradeViolation[];
}

/**
 * Valida un cambio de plan antes de aplicarlo (§2.1.4). Si no entra, dice
 * **exactamente que excede y por cuanto**: un "no podes bajar de plan" sin
 * numeros obliga al usuario a adivinar que tiene que borrar.
 */
export function validateDowngrade(target: PlanId, usage: Usage): DowngradeCheck {
  const limits = planFor(target).limits;
  const violations: DowngradeViolation[] = [];

  for (const [name, max] of Object.entries(limits) as Array<[LimitName, number | null]>) {
    if (max === null) continue;
    const current = usage[name];
    if (current > max) violations.push({ limit: name, current, max });
  }

  return { allowed: violations.length === 0, violations };
}

/** Nombre en español de cada limite, para el mensaje al usuario. */
export const LIMIT_LABELS: Record<LimitName, string> = {
  venues: 'sedes',
  activeMembers: 'miembros activos',
  staffUsers: 'usuarios de staff',
  storageMb: 'MB de almacenamiento',
};
