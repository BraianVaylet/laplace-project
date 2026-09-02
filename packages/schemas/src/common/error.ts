import { z } from 'zod';

/**
 * Codigo de error de Laplace: LP-<MODULE>-<HTTP>-<NNN>.
 * Diccionario completo en docs/errors.md. Spec §11.2.
 */
export const ERROR_CODE_PATTERN = /^LP-[A-Z]{2,4}-[0-9]{3}-[0-9]{3}$/;

export const errorCodeSchema = z
  .string()
  .regex(ERROR_CODE_PATTERN, 'Formato esperado: LP-<MODULE>-<HTTP>-<NNN>');

export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * Envelope unico de error de todas las APIs. Spec §5.0.
 * El `code` y el `requestId` se le muestran al usuario para que pueda
 * compartirlos con soporte.
 */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: errorCodeSchema,
    message: z.string().min(1),
    action: z.string().optional(),
    requestId: z.string().min(1),
    timestamp: z.string().min(1),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiSuccessSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ success: z.literal(true), data });

/** Modulos habilitados para el prefijo del codigo de error. docs/errors.md */
export const ERROR_MODULES = [
  'AUTH',
  'ACCT',
  'SUBS',
  'SUSC',
  'SCHD',
  'BOOK',
  'ATTD',
  'MEMB',
  'PROD',
  'CTRT',
  'BILL',
  'TRNG',
  'PLAN',
  'RSLT',
  'RM',
  'HLTH',
  'NOTF',
  'FDBK',
  'ENTL',
  'CRM',
  'SYS',
] as const;

export type ErrorModule = (typeof ERROR_MODULES)[number];
