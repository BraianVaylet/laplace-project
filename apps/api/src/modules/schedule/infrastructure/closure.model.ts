import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Un feriado o un cierre del centro (§2.1.5.a). **Solo lo usa el repositorio**.
 *
 * Las fechas se guardan como `YYYY-MM-DD` y no como instantes: un feriado es un
 * dia del calendario del centro, no una ventana de 24 horas. Guardarlo como
 * instante obligaria a elegir una hora arbitraria y a recalcularla en cada zona.
 */
export interface VenueClosureDoc extends Record<string, unknown> {
  venueId: string;
  from: string;
  to: string;
  reason: string;
  /** Cuantas clases cancelo al declararse. Queda para poder explicarlo despues. */
  cancelledSessions: number;
}

const closureSchema = new Schema<VenueClosureDoc>(
  {
    venueId: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    reason: { type: String, required: true },
    cancelledSessions: { type: Number, required: true, default: 0, min: 0 },
  },
  { collection: COLLECTIONS.venueClosure },
);

closureSchema.plugin(tenantPlugin);
closureSchema.plugin(baseFieldsPlugin);

export const VenueClosureModel: Model<VenueClosureDoc> =
  (mongoose.models[COLLECTIONS.venueClosure] as Model<VenueClosureDoc> | undefined) ??
  mongoose.model<VenueClosureDoc>(COLLECTIONS.venueClosure, closureSchema);
