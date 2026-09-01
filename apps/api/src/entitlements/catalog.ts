/**
 * Catalogo declarativo de planes. **Manda §2.2.1, no §2.2.**
 *
 * La spec revisa su propio empaquetado en §2.2.1 y explica por que: sin Members
 * ni Billing, el plan Basic es inutilizable y Pro pasa a ser el verdadero piso.
 * Basic incluye gestion de miembros y cobro manual, y su limite de staff baja de
 * 10 a 3 — un centro de 60 socios no tiene 10 empleados.
 *
 * Vive en codigo y no en base: es configuracion de producto, no dato de tenant.
 */

export const PLAN_IDS = ['basic', 'pro', 'max'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Modulos que un plan puede habilitar. Se corresponden con §2.1. */
export const MODULES = [
  'auth',
  'account',
  'entitlements',
  'members',
  'schedule',
  'booking',
  'products',
  'contracts',
  'billing',
  'attendance',
  'waivers',
  'notifications',
  'training',
  'metrics',
  'planning',
  'results',
  'rms',
  'feedback',
  'health',
  'crm',
] as const;
export type ModuleName = (typeof MODULES)[number];

/** Capacidades puntuales dentro de un modulo ya habilitado. */
export const FEATURES = [
  'billing.online',
  'attendance.qr',
  'notifications.push',
  'notifications.whatsapp',
  'training.write',
  'metrics.advanced',
  'wafm.branding',
  'results.tvMode',
  'data.export',
] as const;
export type FeatureName = (typeof FEATURES)[number];

/** `null` = sin limite. */
export interface PlanLimits {
  venues: number | null;
  activeMembers: number | null;
  staffUsers: number | null;
  storageMb: number | null;
}

export type LimitName = keyof PlanLimits;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  modules: readonly ModuleName[];
  features: readonly FeatureName[];
  limits: PlanLimits;
}

/** Lo que todo plan incluye. Sin esto no se puede operar un centro. */
const CORE_MODULES: readonly ModuleName[] = [
  'auth',
  'account',
  'entitlements',
  'members',
  'schedule',
  'booking',
  'products',
  'contracts',
  'billing',
  'attendance',
  'waivers',
  'notifications',
  'training',
  'metrics',
];

const BASIC: PlanDefinition = {
  id: 'basic',
  name: 'Basic',
  modules: CORE_MODULES,
  /** Training es de solo lectura y el check-in es basico: sin QR (§2.2.1). */
  features: ['data.export'],
  limits: { venues: 1, activeMembers: 60, staffUsers: 3, storageMb: 1_000 },
};

const PRO: PlanDefinition = {
  id: 'pro',
  name: 'Pro',
  modules: [...CORE_MODULES, 'planning', 'results', 'rms', 'feedback'],
  features: [
    'data.export',
    'billing.online',
    'attendance.qr',
    'notifications.push',
    'notifications.whatsapp',
    'training.write',
    'metrics.advanced',
  ],
  limits: { venues: 3, activeMembers: 180, staffUsers: 10, storageMb: 10_000 },
};

const MAX: PlanDefinition = {
  id: 'max',
  name: 'Max',
  modules: [...PRO.modules, 'health', 'crm'],
  features: [...PRO.features, 'wafm.branding', 'results.tvMode'],
  limits: { venues: null, activeMembers: null, staffUsers: null, storageMb: null },
};

export const PLANS: Record<PlanId, PlanDefinition> = { basic: BASIC, pro: PRO, max: MAX };

export function planFor(id: PlanId): PlanDefinition {
  return PLANS[id];
}

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}
