import type { ErrorCode } from '@laplace/schemas';

/**
 * Better Auth responde con su propio formato y en ingles. La spec §5.0 exige
 * que toda la API responda con el envelope unificado y en es-AR, asi que sus
 * errores se traducen en el borde. Diccionario en docs/errors.md.
 */
export interface MappedAuthError {
  code: ErrorCode;
  status: number;
  message: string;
  action?: string;
}

/**
 * Mismo codigo y mismo mensaje para "no existe el email" y "la clave esta mal".
 * Distinguirlos convierte el login en un oraculo de qué emails estan registrados
 * (spec §9.1).
 */
const INVALID_CREDENTIALS: MappedAuthError = {
  code: 'LP-AUTH-401-001',
  status: 401,
  message: 'Email o contraseña incorrectos.',
};

const BY_PROVIDER_CODE: Record<string, MappedAuthError> = {
  INVALID_EMAIL_OR_PASSWORD: INVALID_CREDENTIALS,
  INVALID_PASSWORD: INVALID_CREDENTIALS,
  USER_NOT_FOUND: INVALID_CREDENTIALS,
  CREDENTIAL_ACCOUNT_NOT_FOUND: INVALID_CREDENTIALS,

  USER_ALREADY_EXISTS: {
    code: 'LP-AUTH-409-009',
    status: 409,
    message: 'Ese email ya tiene una cuenta.',
    action: 'Probá recuperar la contraseña.',
  },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
    code: 'LP-AUTH-409-009',
    status: 409,
    message: 'Ese email ya tiene una cuenta.',
    action: 'Probá recuperar la contraseña.',
  },

  EMAIL_NOT_VERIFIED: {
    code: 'LP-AUTH-403-004',
    status: 403,
    message: 'Verificá tu email antes de continuar.',
    action: 'Revisá tu casilla; si no llegó, pedí que te lo reenviemos.',
  },

  // ── Plugin de organizaciones (F0-02) ────────────────────────────────────
  NO_ACTIVE_ORGANIZATION: {
    code: 'LP-AUTH-403-011',
    status: 403,
    message: 'Elegí un centro para continuar.',
    action: 'Seleccioná el centro con el que querés operar.',
  },
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: {
    code: 'LP-AUTH-403-011',
    status: 403,
    message: 'No pertenecés a ese centro.',
  },
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION: {
    code: 'LP-AUTH-403-002',
    status: 403,
    message: 'No tenés permisos para esta acción.',
  },
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION: {
    code: 'LP-AUTH-403-002',
    status: 403,
    message: 'No tenés permisos para esta acción.',
  },
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_ORGANIZATION: {
    code: 'LP-AUTH-403-002',
    status: 403,
    message: 'No tenés permisos para esta acción.',
  },
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: {
    code: 'LP-AUTH-403-002',
    status: 403,
    message: 'No tenés permisos para esta acción.',
  },
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE: {
    code: 'LP-AUTH-403-002',
    status: 403,
    message: 'No podés asignar ese rol.',
  },

  INVALID_TOKEN: {
    code: 'LP-AUTH-422-010',
    status: 422,
    message: 'Este enlace ya se usó o venció.',
    action: 'Pedí uno nuevo.',
  },
  TOKEN_EXPIRED: {
    code: 'LP-AUTH-422-010',
    status: 422,
    message: 'Este enlace ya se usó o venció.',
    action: 'Pedí uno nuevo.',
  },
};

const BY_STATUS: Record<number, MappedAuthError> = {
  400: {
    code: 'LP-SYS-422-006',
    status: 400,
    message: 'Revisá los datos ingresados.',
  },
  401: {
    code: 'LP-AUTH-401-005',
    status: 401,
    message: 'Tu sesión expiró.',
    action: 'Entrá de nuevo.',
  },
  403: {
    code: 'LP-AUTH-403-002',
    status: 403,
    message: 'No tenés permisos para esta acción.',
  },
  422: {
    code: 'LP-SYS-422-006',
    status: 422,
    message: 'Revisá los datos ingresados.',
  },
  429: {
    code: 'LP-AUTH-429-003',
    status: 429,
    message: 'Demasiados intentos.',
    action: 'Probá en 5 minutos.',
  },
};

const UNMAPPED: MappedAuthError = {
  code: 'LP-SYS-500-001',
  status: 500,
  message: 'Ocurrió un error. Compartí el código con soporte.',
};

function providerCodeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const code = (body as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : undefined;
}

/**
 * Traduce la respuesta de error de Better Auth al diccionario de Laplace.
 * Un codigo que no esté mapeado cae en LP-SYS-500-001: es preferible un error
 * generico y trazable a inventar un codigo que no existe en docs/errors.md.
 */
export function mapAuthError(status: number, body: unknown): MappedAuthError {
  const byCode = BY_PROVIDER_CODE[providerCodeOf(body) ?? ''];
  if (byCode) return byCode;

  return BY_STATUS[status] ?? UNMAPPED;
}
