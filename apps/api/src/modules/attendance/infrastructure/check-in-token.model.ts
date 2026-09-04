import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo del token del QR. **Solo lo usa el repositorio** (ADR-000).
 *
 * Guarda el hash y nunca el token: el documento vive 30 segundos, pero una
 * coleccion con los codigos en claro es una coleccion de llaves de la puerta.
 *
 * El TTL sobre `expiresAt` lo crea la migracion: sin el, la coleccion crece un
 * documento por cada vez que alguien abre su QR y nadie lo limpia nunca.
 */
export interface CheckInTokenDoc extends Record<string, unknown> {
  memberId: string;
  /** La cuenta que lo pidio. Es la que tiene que coincidir al canjear. */
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  /** Cuando se canjeo. Un token es de un solo uso (§2.1.18). */
  usedAt?: Date | null;
}

const checkInTokenSchema = new Schema<CheckInTokenDoc>(
  {
    memberId: { type: String, required: true },
    userId: { type: String, required: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, required: false, default: null },
  },
  { collection: COLLECTIONS.checkInToken },
);

checkInTokenSchema.plugin(tenantPlugin);
checkInTokenSchema.plugin(baseFieldsPlugin);

export const CheckInTokenModel: Model<CheckInTokenDoc> =
  (mongoose.models[COLLECTIONS.checkInToken] as Model<CheckInTokenDoc> | undefined) ??
  mongoose.model<CheckInTokenDoc>(COLLECTIONS.checkInToken, checkInTokenSchema);
