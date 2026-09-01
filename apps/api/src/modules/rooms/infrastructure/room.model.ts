import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Room. **Solo lo usa el repositorio** (ADR-000 regla 1):
 * un controller que toque esto directamente se saltea la inyeccion de tenantId.
 */
export interface RoomDoc extends Record<string, unknown> {
  venueId: string;
  name: string;
  capacity: number;
  equipment: Array<{ kind: string; label?: string; quantity: number }>;
  status: string;
}

const roomSchema = new Schema<RoomDoc>(
  {
    // El `publicId` del Venue, no su `_id`: es el que viaja por la API y el que
    // ya esta indexado junto al tenant (`{ tenantId, venueId }` de F0-10).
    venueId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    capacity: { type: Number, required: true, min: 1 },
    equipment: [
      {
        _id: false,
        kind: { type: String, required: true },
        label: { type: String, required: false },
        quantity: { type: Number, required: true, min: 1 },
      },
    ],
    status: { type: String, required: true, default: 'active', index: true },
  },
  { collection: COLLECTIONS.room },
);

roomSchema.plugin(tenantPlugin);
roomSchema.plugin(baseFieldsPlugin);

/** El modelo se registra una sola vez: en los tests el modulo se importa varias. */
export const RoomModel: Model<RoomDoc> =
  (mongoose.models[COLLECTIONS.room] as Model<RoomDoc> | undefined) ??
  mongoose.model<RoomDoc>(COLLECTIONS.room, roomSchema);
