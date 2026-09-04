import { isMinorOn } from '@laplace/schemas';

/**
 * Qué documento le aplica a quién (§2.1.20).
 *
 * `guardian_consent` es el único tipo condicional: **siempre obligatorio**
 * cuando aplica, y solo aplica a menores. No es una opción que el SMU pueda
 * apagar — al publicarlo se fuerza `required: true` (ver `contract.ts`), así
 * que acá la única pregunta es si le corresponde a esta persona.
 */
export const GUARDIAN_CONSENT_TYPE = 'guardian_consent' as const;

export interface DocumentRequirement {
  documentId: string;
  type: string;
  required: boolean;
}

export interface MemberForWaivers {
  birthDate?: string | undefined;
}

/** ¿Este documento es parte de lo que hay que tener firmado para entrar? */
export function appliesTo(
  document: DocumentRequirement,
  member: MemberForWaivers,
  today: string,
): boolean {
  if (!document.required) return false;
  if (document.type !== GUARDIAN_CONSENT_TYPE) return true;

  // Sin fecha de nacimiento no se puede probar que es menor: no se le exige
  // un documento pensado para un caso que no se puede confirmar.
  return member.birthDate !== undefined && isMinorOn(member.birthDate, today);
}

/** Los documentos, de la lista de vigentes, que le corresponden a esta persona. */
export function requirementsFor<T extends DocumentRequirement>(
  current: readonly T[],
  member: MemberForWaivers,
  today: string,
): T[] {
  return current.filter((document) => appliesTo(document, member, today));
}
