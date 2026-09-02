import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Contract. **Solo lo usa el repositorio** (ADR-000).
 *
 * Los campos que arrancan con `product` son una **copia del producto al momento
 * de vender**, no una referencia: el centro puede editar el precio, las
 * categorias o la vigencia manana, y el contrato tiene que seguir valiendo por
 * lo que se vendio. Es la misma razon por la que existe `priceSnapshotCents`,
 * aplicada al resto de las condiciones.
 */
export interface ContractDoc extends Record<string, unknown> {
  memberId: string;
  productId: string;
  venueId: string;
  productType: string;
  productName: string;
  priceSnapshotCents: number;
  currency: string;
  creditsTotal: number;
  creditsUsed: number;
  allowedCategories: string[];
  allowedTimeRanges: Array<{ from: string; to: string }>;
  weeklyLimit?: number;
  monthlyLimit?: number;
  startsAt: Date;
  endsAt?: Date | null;
  status: string;
  autoRenew: boolean;
}

const contractSchema = new Schema<ContractDoc>(
  {
    memberId: { type: String, required: true },
    productId: { type: String, required: true },
    venueId: { type: String, required: true },
    productType: { type: String, required: true },
    productName: { type: String, required: true },
    priceSnapshotCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'ARS' },
    creditsTotal: { type: Number, required: true, default: 0, min: 0 },
    creditsUsed: { type: Number, required: true, default: 0, min: 0 },
    allowedCategories: { type: [String], required: true, default: [] },
    allowedTimeRanges: [{ _id: false, from: String, to: String }],
    weeklyLimit: { type: Number, required: false },
    monthlyLimit: { type: Number, required: false },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: false, default: null },
    status: { type: String, required: true, default: 'pending_payment' },
    autoRenew: { type: Boolean, required: true, default: false },
  },
  { collection: COLLECTIONS.contract },
);

contractSchema.plugin(tenantPlugin);
contractSchema.plugin(baseFieldsPlugin);

export const ContractModel: Model<ContractDoc> =
  (mongoose.models[COLLECTIONS.contract] as Model<ContractDoc> | undefined) ??
  mongoose.model<ContractDoc>(COLLECTIONS.contract, contractSchema);
