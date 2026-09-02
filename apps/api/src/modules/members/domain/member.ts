import { MEMBER_TRANSITIONS, isMinorOn, type MemberStatus } from '@laplace/schemas';

/**
 * El socio: la entidad sobre la que gira el resto del producto.
 *
 * Reglas puras, sin Mongoose ni Hono.
 */

/** §14: los estados cambian solo por transicion explicita y validada. */
export function canTransition(from: MemberStatus, to: MemberStatus): boolean {
  return MEMBER_TRANSITIONS[from].includes(to);
}

/**
 * §2.2.1: el limite se cuenta sobre miembros activos, no historicos. Archivar a
 * los que se fueron no debe costar plata.
 */
export function countsTowardPlanLimit(status: MemberStatus): boolean {
  return status !== 'archived';
}

/**
 * ¿Hace falta cargar un tutor? (§2.1.7)
 *
 * Sin fecha de nacimiento no se puede afirmar que sea menor, asi que no se
 * exige: inventar el bloqueo con un dato que no existe traba altas legitimas.
 * El corte real para reservar lo pone el consentimiento firmado (F1-20).
 */
export function requiresGuardian(birthDate: string | undefined, today: string): boolean {
  return birthDate !== undefined && isMinorOn(birthDate, today);
}

/** "Nombre Apellido", para listas, mails y la lista de clase del coach. */
export function fullName(member: { firstName: string; lastName: string }): string {
  return `${member.firstName} ${member.lastName}`;
}
