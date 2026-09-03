import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de LegalDocument. **Solo lo usa el repositorio** (ADR-000).
 *
 * Cada publicación es una fila nueva, nunca una edición: "versionado" quiere
 * decir que la v1 sigue existiendo después de publicar la v2, porque alguien
 * pudo haber firmado la v1 y hay que poder mostrar exactamente qué firmó.
 *
 * El único `{ tenantId, type, version }` de la migración de F1-20 es lo que
 * impide publicar dos veces el mismo número de versión del mismo tipo.
 */
export interface LegalDocumentDoc extends Record<string, unknown> {
  type: string;
  title: string;
  contentHtml: string;
  contentHash: string;
  version: number;
  required: boolean;
  publishedAt: Date;
}

const legalDocumentSchema = new Schema<LegalDocumentDoc>(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    contentHtml: { type: String, required: true },
    contentHash: { type: String, required: true },
    version: { type: Number, required: true },
    required: { type: Boolean, required: true, default: true },
    publishedAt: { type: Date, required: true },
  },
  { collection: COLLECTIONS.legalDocument },
);

legalDocumentSchema.plugin(tenantPlugin);
legalDocumentSchema.plugin(baseFieldsPlugin);

export const LegalDocumentModel: Model<LegalDocumentDoc> =
  (mongoose.models[COLLECTIONS.legalDocument] as Model<LegalDocumentDoc> | undefined) ??
  mongoose.model<LegalDocumentDoc>(COLLECTIONS.legalDocument, legalDocumentSchema);
