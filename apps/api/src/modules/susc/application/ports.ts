import type { Temporal } from '@js-temporal/polyfill';

/**
 * Puertos de Suscriptors. Lo que necesita de afuera lo pide por interfaz: no
 * importa el modelo de nadie (ADR-003), y la organización la crea Better Auth,
 * que este módulo tampoco conoce.
 */

/**
 * Crea la organización del suscriptor. Lo implementa Better Auth desde el punto
 * de composición: los módulos no conocen la librería de identidad.
 */
export interface OrganizationCreator {
  create(input: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<{ organizationId: string }>;
}

/**
 * Lo que el centro tiene hoy, para poder decirle qué excede si quiere bajar de
 * plan (§2.1.4). Los tres números que los planes topean.
 */
export interface UsageLookup {
  of(organizationId: string): Promise<{
    venues: number;
    activeMembers: number;
    staffUsers: number;
  }>;
}

/** Los topes del plan, del catálogo de entitlements (F0-07). */
export interface PlanLimitsLookup {
  of(planId: string): {
    venues: number | null;
    activeMembers: number | null;
    staffUsers: number | null;
  };
}

/**
 * Las corridas de job que fallaron. Las consulta el panel de salud (§11.3): un
 * job que falla en silencio es peor que un job que no existe.
 */
export interface JobRunLookup {
  failedSince(since: Temporal.Instant): Promise<Array<{ name: string; at: string; error: string }>>;
}

/**
 * Lo que el centro tiene cargado, para el asistente de onboarding (§2.1.3).
 *
 * 🔴 Son **conteos del estado real**, no banderas que alguien marcó. Un
 * checklist auto-declarado dice "clase publicada" sin que exista una clase, y
 * el SMU se entera cuando un socio abre la app y no encuentra nada.
 */
export interface CenterSetupLookup {
  of(organizationId: string): Promise<{
    venues: number;
    venuesWithHours: number;
    classTemplates: number;
    products: number;
    inviteCodes: number;
  }>;
}
