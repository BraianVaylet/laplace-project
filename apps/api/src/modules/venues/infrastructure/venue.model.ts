import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Venue. **Solo lo usa el repositorio** (ADR-000 regla 1):
 * un controller que toque esto directamente se saltea la inyeccion de tenantId.
 */
export interface VenueDoc extends Record<string, unknown> {
  name: string;
  address: string;
  phone?: string;
  timeZone: string;
  currency: string;
  businessHours: Array<{ weekday: number; opensAt: string; closesAt: string }>;
  bookingPolicy: Record<string, unknown>;
  branding?: { logoUrl?: string; primaryColor?: string };
  geo?: { lat: number; lng: number };
  status: string;
}

const venueSchema = new Schema<VenueDoc>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    phone: { type: String, required: false },
    timeZone: { type: String, required: true },
    currency: { type: String, required: true, default: 'ARS' },
    businessHours: [
      {
        _id: false,
        weekday: { type: Number, required: true },
        opensAt: { type: String, required: true },
        closesAt: { type: String, required: true },
      },
    ],
    bookingPolicy: { type: Schema.Types.Mixed, required: true },
    branding: {
      type: { logoUrl: String, primaryColor: String },
      required: false,
      _id: false,
    },
    geo: { type: { lat: Number, lng: Number }, required: false, _id: false },
    status: { type: String, required: true, default: 'active', index: true },
  },
  { collection: COLLECTIONS.venue },
);

venueSchema.plugin(tenantPlugin);
venueSchema.plugin(baseFieldsPlugin);

/** El modelo se registra una sola vez: en los tests el modulo se importa varias. */
export const VenueModel: Model<VenueDoc> =
  (mongoose.models[COLLECTIONS.venue] as Model<VenueDoc> | undefined) ??
  mongoose.model<VenueDoc>(COLLECTIONS.venue, venueSchema);
