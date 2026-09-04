import mongoose, { Schema, type Model } from 'mongoose';
import { CONTACT_SOURCES } from '@laplace/schemas';
import { COLLECTIONS } from '../../../persistence/collections.js';

/**
 * Lo que deja alguien en el formulario de la landing. **Solo lo usa el
 * repositorio** (ADR-000).
 *
 * 🔴 **No lleva `tenantId` y no es un olvido.** Quien escribe todavía no tiene
 * centro: es un prospecto de Laplace, no de un gimnasio. El `Lead` de §5.2.2
 * — con `tenantId` y `venueId` — es otra cosa: el prospecto que un centro
 * quiere convertir en socio, y llega con el CRM de Fase 4.
 *
 * Es una colección de plataforma, como `subscriptions`.
 */
export interface ContactRequestDoc extends Record<string, unknown> {
  name: string;
  email: string;
  phone: string | null;
  centerName: string | null;
  message: string;
  source: string;
  /** Para responder desde dónde llegó, y para medir de dónde vienen. */
  receivedAt: Date;
}

const contactRequestSchema = new Schema<ContactRequestDoc>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: false, default: null },
    centerName: { type: String, required: false, default: null },
    message: { type: String, required: true },
    source: { type: String, required: true, enum: CONTACT_SOURCES, default: 'landing' },
    receivedAt: { type: Date, required: true },
  },
  { collection: COLLECTIONS.contactRequest, timestamps: true },
);

export const ContactRequestModel: Model<ContactRequestDoc> =
  (mongoose.models[COLLECTIONS.contactRequest] as Model<ContactRequestDoc> | undefined) ??
  mongoose.model<ContactRequestDoc>(COLLECTIONS.contactRequest, contactRequestSchema);
