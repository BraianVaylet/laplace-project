import { randomBytes } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH, type InviteCodeStatus } from '@laplace/schemas';

/**
 * El codigo con el que un atleta asocia su cuenta de la WAFM a un centro
 * (§2.1.7).
 *
 * Reglas puras, sin Mongoose ni Hono.
 */
export interface InviteCodeState {
  revokedAt: Temporal.Instant | null;
  expiresAt: Temporal.Instant;
  usedCount: number;
  maxUses: number;
}

/**
 * El estado que ve el staff. Es derivado, no un campo: guardarlo obligaria a un
 * job que lo actualice y a que ese job no se atrase nunca.
 *
 * La revocacion gana sobre todo lo demas: si el codigo se filtro, lo que importa
 * es que esta cortado, no que ademas le quedaban usos.
 */
export function resolveInviteCodeStatus(
  code: InviteCodeState,
  now: Temporal.Instant,
): InviteCodeStatus {
  if (code.revokedAt !== null) return 'revoked';
  if (Temporal.Instant.compare(code.expiresAt, now) <= 0) return 'expired';
  if (code.usedCount >= code.maxUses) return 'exhausted';

  return 'active';
}

/**
 * Genera un codigo aleatorio del alfabeto de §2.1.7.
 *
 * Se descartan los bytes que caen fuera del rango parejo en vez de usar
 * `% alfabeto.length`: el modulo sobre bytes de 0..255 hace que las primeras
 * letras salgan mas seguido, y en un codigo que alguien puede querer adivinar
 * el sesgo es exactamente lo que no se quiere.
 */
export function generateInviteCode(): string {
  const alphabet = INVITE_CODE_ALPHABET;
  // El mayor multiplo del alfabeto que entra en un byte. Todo lo de arriba se
  // descarta para que cada letra tenga la misma probabilidad.
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;

  let code = '';
  while (code.length < INVITE_CODE_LENGTH) {
    for (const byte of randomBytes(INVITE_CODE_LENGTH)) {
      if (byte >= limit) continue;
      code += alphabet[byte % alphabet.length];
      if (code.length === INVITE_CODE_LENGTH) break;
    }
  }

  return code;
}
