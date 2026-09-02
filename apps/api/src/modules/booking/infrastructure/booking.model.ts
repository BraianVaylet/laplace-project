import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Booking. **Solo lo usa el repositorio** (ADR-000).
 *
 * El indice UNICO `{ tenantId, sessionId, memberId }` de §5.2.3 es el ultimo
 * cinturon contra la doble reserva: el chequeo previo puede perder la carrera,
 * el indice no.
 */
export interface BookingDoc extends Record<string, unknown> {
  sessionId: string;
  memberId: string;
  venueId: string;
  /** De que contrato salio el credito. Ausente si entro sin consumir. */
  contractId?: string;
  status: string;
  waitlistPosition?: number | null;
  bookedAt: Date;
  /** §5.0: obligatorio en reservas. El unico parcial evita la doble reserva por reintento. */
  idempotencyKey?: string;
}

const bookingSchema = new Schema<BookingDoc>(
  {
    sessionId: { type: String, required: true },
    memberId: { type: String, required: true },
    venueId: { type: String, required: true },
    contractId: { type: String, required: false },
    status: { type: String, required: true, default: 'booked' },
    waitlistPosition: { type: Number, required: false, default: null },
    bookedAt: { type: Date, required: true },
    idempotencyKey: { type: String, required: false },
  },
  { collection: COLLECTIONS.booking },
);

bookingSchema.plugin(tenantPlugin);
bookingSchema.plugin(baseFieldsPlugin);

export const BookingModel: Model<BookingDoc> =
  (mongoose.models[COLLECTIONS.booking] as Model<BookingDoc> | undefined) ??
  mongoose.model<BookingDoc>(COLLECTIONS.booking, bookingSchema);
