import { z } from 'zod';

/**
 * Fuente única de validación de Waivers, compartida front/back (ADR-003).
 *
 * Es riesgo legal, no una funcionalidad opcional (§2.1.20): deslindes y
 * consentimientos versionados, con firma trazable — qué se firmó, cuándo, y
 * probablemente probado en un juicio, no en un dashboard.
 */

/**
 * Los seis tipos de §2.1.20. `guardian_consent` es especial: no es una opción
 * del SMU, es obligatorio siempre que aplica y solo aplica a menores.
 */
export const LEGAL_DOCUMENT_TYPES = [
  'liability_waiver',
  'terms',
  'privacy_policy',
  'health_consent',
  'image_consent',
  'guardian_consent',
] as const;

export const legalDocumentTypeSchema = z.enum(LEGAL_DOCUMENT_TYPES);
export type LegalDocumentType = z.infer<typeof legalDocumentTypeSchema>;

export const publishLegalDocumentSchema = z.object({
  type: legalDocumentTypeSchema,
  title: z.string().trim().min(3, 'Ponele un título al documento.').max(120),
  contentHtml: z.string().trim().min(1, 'El documento no puede estar vacío.'),
  /**
   * `guardian_consent` se publica siempre obligatorio: el valor que llegue acá
   * para ese tipo se ignora, no es una decisión que el SMU tenga que tomar.
   */
  required: z.boolean().default(true),
});

export type PublishLegalDocumentInput = z.infer<typeof publishLegalDocumentSchema>;

export const legalDocumentSchema = z.object({
  publicId: z.string(),
  type: legalDocumentTypeSchema,
  title: z.string(),
  contentHtml: z.string(),
  contentHash: z.string(),
  /** Correlativo por tipo, empieza en 1. Publicar de nuevo el mismo tipo suma uno. */
  version: z.number().int(),
  required: z.boolean(),
  publishedAt: z.string(),
});

export type LegalDocument = z.infer<typeof legalDocumentSchema>;

/** Lo que ve el socio: el documento más si ya lo tiene firmado. */
export const pendingDocumentSchema = legalDocumentSchema.extend({
  accepted: z.boolean(),
});

export type PendingDocument = z.infer<typeof pendingDocumentSchema>;

export const consentSchema = z.object({
  publicId: z.string(),
  documentId: z.string(),
  documentType: legalDocumentTypeSchema,
  version: z.number().int(),
  acceptedAt: z.string(),
  ip: z.string(),
  userAgent: z.string(),
});

export type Consent = z.infer<typeof consentSchema>;

/** El panel de cumplimiento (§2.1.20): quién firmó qué documento y cuándo. */
export const complianceEntrySchema = z.object({
  memberId: z.string().nullable(),
  fullName: z.string(),
  version: z.number().int(),
  acceptedAt: z.string(),
});

export type ComplianceEntry = z.infer<typeof complianceEntrySchema>;
