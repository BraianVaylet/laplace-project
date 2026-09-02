import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Product. **Solo lo usa el repositorio** (ADR-000 regla 1).
 *
 * El indice `{ tenantId, active, type }` vive en la migracion de F0-10.
 */
export interface ProductDoc extends Record<string, unknown> {
  name: string;
  description?: string;
  type: string;
  /** Centavos ENTEROS (§3.1). El tipo del campo es la primera defensa. */
  priceCents: number;
  currency: string;
  credits?: number;
  durationDays?: number;
  weeklyLimit?: number;
  monthlyLimit?: number;
  allowedCategories: string[];
  allowedTimeRanges: Array<{ from: string; to: string }>;
  venueIds: string[];
  visibleInApp: boolean;
  autoRenew: boolean;
  maxSales?: number;
  soldCount: number;
  active: boolean;
}

const productSchema = new Schema<ProductDoc>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: false },
    type: { type: String, required: true },
    priceCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'ARS' },
    credits: { type: Number, required: false },
    durationDays: { type: Number, required: false },
    weeklyLimit: { type: Number, required: false },
    monthlyLimit: { type: Number, required: false },
    allowedCategories: { type: [String], required: true, default: [] },
    allowedTimeRanges: [{ _id: false, from: String, to: String }],
    venueIds: { type: [String], required: true },
    visibleInApp: { type: Boolean, required: true, default: true },
    autoRenew: { type: Boolean, required: true, default: false },
    maxSales: { type: Number, required: false },
    /** Lo incrementa Contracts al vender (F1-08). */
    soldCount: { type: Number, required: true, default: 0, min: 0 },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: COLLECTIONS.product },
);

productSchema.plugin(tenantPlugin);
productSchema.plugin(baseFieldsPlugin);

export const ProductModel: Model<ProductDoc> =
  (mongoose.models[COLLECTIONS.product] as Model<ProductDoc> | undefined) ??
  mongoose.model<ProductDoc>(COLLECTIONS.product, productSchema);
