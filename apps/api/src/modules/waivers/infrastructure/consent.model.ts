import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Consent. **Solo lo usa el repositorio** (ADR-000).
 *
 * Va por `userId`, no por `memberId` (§5.2.2): quien firma es la cuenta que
 * inició sesión, y Waivers no sabe qué es un `Member` — eso lo resuelve quien
 * llama, por interfaz (ADR-003).
 *
 * El único `{ tenantId, userId, documentId }` de la migración de F1-20 es lo
 * que hace que aceptar dos veces el mismo documento (doble click) no duplique
 * el registro: el segundo intento encuentra el primero y lo devuelve.
 */
export interface ConsentDoc extends Record<string, unknown> {
  userId: string;
  documentId: string;
  documentType: string;
  version: number;
  /** Copia del hash del documento al momento de firmar (§2.1.20). */
  contentHash: string;
  acceptedAt: Date;
  ip: string;
  userAgent: string;
  revokedAt?: Date | null;
}

const consentSchema = new Schema<ConsentDoc>(
  {
    userId: { type: String, required: true },
    documentId: { type: String, required: true },
    documentType: { type: String, required: true },
    version: { type: Number, required: true },
    contentHash: { type: String, required: true },
    acceptedAt: { type: Date, required: true },
    ip: { type: String, required: true },
    userAgent: { type: String, required: true },
    revokedAt: { type: Date, required: false, default: null },
  },
  { collection: COLLECTIONS.consent },
);

consentSchema.plugin(tenantPlugin);
consentSchema.plugin(baseFieldsPlugin);

export const ConsentModel: Model<ConsentDoc> =
  (mongoose.models[COLLECTIONS.consent] as Model<ConsentDoc> | undefined) ??
  mongoose.model<ConsentDoc>(COLLECTIONS.consent, consentSchema);
