import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de InviteCode. **Solo lo usa el repositorio**.
 *
 * Los indices viven en las migraciones: `{ tenantId, code }` unico (F0-10) y el
 * `{ code }` unico GLOBAL de la migracion de F1-04, que es lo que hace que el
 * canje sepa a que centro asociar a la persona.
 */
export interface InviteCodeDoc extends Record<string, unknown> {
  code: string;
  venueId: string;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  revokedAt?: Date | null;
}

const inviteCodeSchema = new Schema<InviteCodeDoc>(
  {
    code: { type: String, required: true },
    venueId: { type: String, required: true },
    maxUses: { type: Number, required: true, min: 1 },
    usedCount: { type: Number, required: true, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, required: false, default: null },
  },
  { collection: COLLECTIONS.inviteCode },
);

inviteCodeSchema.plugin(tenantPlugin);
inviteCodeSchema.plugin(baseFieldsPlugin);

export const InviteCodeModel: Model<InviteCodeDoc> =
  (mongoose.models[COLLECTIONS.inviteCode] as Model<InviteCodeDoc> | undefined) ??
  mongoose.model<InviteCodeDoc>(COLLECTIONS.inviteCode, inviteCodeSchema);
