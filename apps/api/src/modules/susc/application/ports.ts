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
