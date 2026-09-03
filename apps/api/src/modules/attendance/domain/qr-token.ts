import { createHash, randomBytes } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../../../http/errors.js';

/**
 * El token del QR de la WAFM (§2.1.18).
 *
 * **Vida corta y un solo uso**, por un motivo concreto: la captura de pantalla
 * que el socio le manda a su amiga por WhatsApp no tiene que servir para
 * entrar. Treinta segundos alcanzan para caminar del teléfono a la tablet y no
 * para llegar a la puerta con un código de otro.
 *
 * Y lo que se guarda es el **hash**: una base con los tokens en claro es una
 * base de llaves de la puerta, y el token vive lo suficiente como para que
 * leerla sirva.
 */
export const QR_TOKEN_TTL_SECONDS = 30;

/** 24 bytes en base64url: 32 caracteres sin nada que un QR tenga que escapar. */
const TOKEN_BYTES = 24;

export interface NewCheckInToken {
  /** Va al QR del socio y **no** se guarda. */
  token: string;
  tokenHash: string;
  expiresAt: Temporal.Instant;
}

export function newCheckInToken(now: Temporal.Instant): NewCheckInToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: now.add({ seconds: QR_TOKEN_TTL_SECONDS }),
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface StoredToken {
  expiresAt: Temporal.Instant;
  usedAt: Temporal.Instant | null;
}

/**
 * Los dos motivos por los que un token deja de valer dan el **mismo** error a
 * propósito: distinguir "vencido" de "ya usado" le diría a quien prueba códigos
 * ajenos cuál de los dos casi funcionó.
 */
export function assertTokenUsable(token: StoredToken, now: Temporal.Instant): void {
  const vencido = Temporal.Instant.compare(now, token.expiresAt) > 0;

  if (!vencido && token.usedAt === null) return;

  throw new AppError({
    code: 'LP-ATTD-422-004',
    status: 422,
    message: 'El código venció. Abrí de nuevo tu QR.',
    action: 'Mostrá el código nuevo en la puerta.',
  });
}
