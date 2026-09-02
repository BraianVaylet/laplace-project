import { z } from 'zod';

/**
 * Fuente única de validación de InviteCodes, compartida front/back (ADR-003).
 *
 * Es el código con el que un atleta asocia su cuenta de la WAFM a un centro
 * (§2.1.7). La v1 no definía vencimiento ni límite de usos: un código filtrado
 * sin vencimiento se usa para siempre.
 */

/**
 * Sin `O`, `0`, `I`, `1` ni `L`: el código se dicta por teléfono y se copia de un
 * WhatsApp, y esas cinco son las que la gente confunde.
 */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_CODE_LENGTH = 8;

/**
 * Deja el código como se guarda: mayúsculas, sin guiones ni espacios.
 *
 * El usuario lo copia de donde se lo mandaron. Rechazarlo por un guion de más es
 * hacerle perder el alta a un socio que ya quiso darse de alta.
 */
export function normalizeInviteCode(code: string): string {
  return code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

export const INVITE_CODE_STATES = ['active', 'expired', 'exhausted', 'revoked'] as const;
export const inviteCodeStatusSchema = z.enum(INVITE_CODE_STATES);
export type InviteCodeStatus = z.infer<typeof inviteCodeStatusSchema>;

/**
 * El `code` **no** está acá: lo genera el sistema, no el centro. Si el centro
 * pudiera elegirlo, dos centros elegirían "VERANO2026" y el canje dejaría de
 * saber a cuál de los dos asociar a la persona.
 */
export const createInviteCodeSchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  /** Cuántas personas pueden usarlo. Sin límite, un código filtrado es una puerta abierta. */
  maxUses: z
    .number()
    .int('El límite de usos se cuenta en personas enteras.')
    .min(1, 'El código tiene que servir para al menos una persona.')
    .max(1000),
  /** Vencimiento, en ISO 8601. Lo valida el servicio contra su reloj. */
  expiresAt: z.string().datetime({ offset: true, message: 'Elegí una fecha de vencimiento.' }),
});

export type CreateInviteCodeInput = z.infer<typeof createInviteCodeSchema>;

/**
 * El canje trae nombre y apellido. Partir el nombre de la cuenta ("Juan Pérez"
 * → nombre + apellido) falla con un apellido compuesto y con quien se registró
 * con un solo nombre, y deja la ficha del socio mal desde el día uno.
 */
export const redeemInviteCodeSchema = z.object({
  code: z
    .string()
    .transform(normalizeInviteCode)
    .refine((code) => code.length > 0, 'Ingresá el código que te dio el centro.'),
  firstName: z.string().trim().min(2, 'Cargá tu nombre.').max(60),
  lastName: z.string().trim().min(2, 'Cargá tu apellido.').max(60),
});

export type RedeemInviteCodeInput = z.infer<typeof redeemInviteCodeSchema>;

export const inviteCodeSchema = z.object({
  publicId: z.string(),
  code: z.string(),
  venueId: z.string(),
  maxUses: z.number().int(),
  usedCount: z.number().int(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  status: inviteCodeStatusSchema,
  createdAt: z.string(),
});

export type InviteCode = z.infer<typeof inviteCodeSchema>;

/** Lo que devuelve un canje exitoso. No expone nada del centro más allá del nombre. */
export const redeemResultSchema = z.object({
  memberId: z.string(),
  venueId: z.string(),
  organizationId: z.string(),
});

export type RedeemResult = z.infer<typeof redeemResultSchema>;
