import { z } from 'zod';

/**
 * Lo que el socio ve y edita de lo suyo (§2.1.2, §9.2). Compartido front/back
 * (ADR-003).
 *
 * 🔴 Todo lo de acá se resuelve con la ficha de **la sesión**. Ningún endpoint
 * de este módulo acepta un `memberId` por parámetro: si lo aceptara, el socio
 * podría pedir el perfil del compañero de al lado, y el aislamiento por tenant
 * no lo taparía porque los dos son del mismo centro.
 */

/** Un pack del socio, con lo único que le importa: qué le queda y hasta cuándo. */
export const myContractSchema = z.object({
  contractId: z.string(),
  productName: z.string(),
  productType: z.string(),
  status: z.string(),
  /** `null` en una membresía: no se cuenta por clases. */
  creditsLeft: z.number().int().nullable(),
  creditsTotal: z.number().int().nullable(),
  /** `null` cuando no vence. */
  endsAt: z.string().nullable(),
  /** Días que faltan. Negativo si ya venció; `null` si no vence. */
  daysLeft: z.number().int().nullable(),
  /** `true` cuando faltan 7 días o menos: es cuando se muestra el CTA. */
  expiringSoon: z.boolean(),
  /** Vacío = sirve para todas las clases. */
  allowedCategories: z.array(z.string()),
  venueId: z.string(),
});

export type MyContract = z.infer<typeof myContractSchema>;

// ── Perfil ──────────────────────────────────────────────────────────────────

export const emergencyContactSchema = z.object({
  fullName: z.string().trim().min(2, 'Poné el nombre de tu contacto.').max(80),
  phone: z.string().trim().min(6, 'Poné un teléfono al que se pueda llamar.').max(30),
  relationship: z.string().trim().max(40).optional(),
});

export const updateMyProfileSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email('Revisá el mail.').optional(),
  emergencyContact: emergencyContactSchema.optional(),
});

export type UpdateMyProfileInput = z.infer<typeof updateMyProfileSchema>;

export const myProfileSchema = z.object({
  memberId: z.string(),
  fullName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  emergencyContact: emergencyContactSchema.nullable(),
  /**
   * 🔴 Una URL **firmada y de vida corta**, no un enlace público permanente a
   * la foto de una persona (§2.1.2). `null` si todavía no subió ninguna.
   */
  avatarUrl: z.string().nullable(),
});

export type MyProfile = z.infer<typeof myProfileSchema>;

export const avatarUploadedSchema = z.object({
  avatarUrl: z.string(),
  /** Cuándo deja de servir el enlace. La app lo vuelve a pedir después. */
  expiresAt: z.string(),
});

export type AvatarUploaded = z.infer<typeof avatarUploadedSchema>;

// ── Derechos ARCO (§9.2, Ley 25.326) ────────────────────────────────────────

/**
 * Lo que el titular se lleva cuando pide sus datos. En JSON y completo: el
 * derecho de acceso no se cumple con un resumen elegido por nosotros.
 */
export const myDataExportSchema = z.object({
  exportedAt: z.string(),
  profile: myProfileSchema,
  contracts: z.array(myContractSchema),
  bookings: z.array(
    z.object({
      bookingId: z.string(),
      sessionId: z.string(),
      status: z.string(),
      bookedAt: z.string(),
    }),
  ),
  consents: z.array(
    z.object({ documentType: z.string(), version: z.number().int(), acceptedAt: z.string() }),
  ),
});

export type MyDataExport = z.infer<typeof myDataExportSchema>;

/**
 * La baja se **pide**, no se ejecuta sola: el centro tiene obligaciones legales
 * sobre lo firmado y lo cobrado, y borrar en el acto las incumpliría. Queda
 * registrada con fecha, que es lo que hace exigible el plazo (§9.2).
 */
export const deletionRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export type DeletionRequestInput = z.infer<typeof deletionRequestSchema>;

export const deletionRequestResultSchema = z.object({
  requestedAt: z.string(),
  /** Cuándo se purga, si nadie lo frena. ADR-004: 90 días. */
  purgeAfter: z.string(),
});

export type DeletionRequestResult = z.infer<typeof deletionRequestResultSchema>;
