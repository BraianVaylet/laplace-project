import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelos de Billing. **Solo los usa el repositorio** (ADR-000 regla 1).
 *
 * Todos los montos son `Number` **enteros en centavos** (§3.1). Un float en
 * cualquiera de los tres termina en un saldo que no cierra y que nadie puede
 * explicar seis meses despues.
 *
 * Los indices viven en la migracion de F0-10, incluido el unico PARCIAL
 * `{ tenantId, idempotencyKey }` de `payments`, que es lo que hace que el
 * reintento de un pago no cobre dos veces.
 */
export interface ChargeDoc extends Record<string, unknown> {
  memberId: string;
  venueId: string;
  contractId?: string;
  amountCents: number;
  /** Cuanto se pago de este cargo. Menor al total = pago parcial. */
  paidCents: number;
  currency: string;
  dueAt: Date;
  status: string;
  description: string;
  /**
   * La clave de la **venta de mostrador** que lo originó (F1-37). Va en el
   * cargo y no en el pago porque el cargo es la única pieza que siempre existe:
   * se puede vender hoy y cobrar el viernes.
   */
  idempotencyKey?: string | null;
}

const chargeSchema = new Schema<ChargeDoc>(
  {
    memberId: { type: String, required: true },
    venueId: { type: String, required: true },
    contractId: { type: String, required: false },
    amountCents: { type: Number, required: true, min: 1 },
    paidCents: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, default: 'ARS' },
    dueAt: { type: Date, required: true },
    status: { type: String, required: true, default: 'pending' },
    description: { type: String, required: true },
    idempotencyKey: { type: String, required: false, default: null },
  },
  { collection: COLLECTIONS.charge },
);

chargeSchema.plugin(tenantPlugin);
chargeSchema.plugin(baseFieldsPlugin);

export const ChargeModel: Model<ChargeDoc> =
  (mongoose.models[COLLECTIONS.charge] as Model<ChargeDoc> | undefined) ??
  mongoose.model<ChargeDoc>(COLLECTIONS.charge, chargeSchema);

export interface PaymentDoc extends Record<string, unknown> {
  memberId: string;
  venueId: string;
  chargeIds: string[];
  amountCents: number;
  refundedCents: number;
  currency: string;
  method: string;
  status: string;
  receipt?: string;
  note?: string;
  receivedAt: Date;
  /** Quien lo registro. En un arqueo que no cierra, es la primera pregunta. */
  receivedBy: string;
  /** §5.0: obligatorio. El unico parcial sobre esto es lo que evita el doble cobro. */
  idempotencyKey: string;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    memberId: { type: String, required: true },
    venueId: { type: String, required: true },
    chargeIds: { type: [String], required: true, default: [] },
    amountCents: { type: Number, required: true, min: 1 },
    refundedCents: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, default: 'ARS' },
    method: { type: String, required: true },
    status: { type: String, required: true, default: 'approved' },
    receipt: { type: String, required: false },
    note: { type: String, required: false },
    receivedAt: { type: Date, required: true },
    receivedBy: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
  },
  { collection: COLLECTIONS.payment },
);

paymentSchema.plugin(tenantPlugin);
paymentSchema.plugin(baseFieldsPlugin);

export const PaymentModel: Model<PaymentDoc> =
  (mongoose.models[COLLECTIONS.payment] as Model<PaymentDoc> | undefined) ??
  mongoose.model<PaymentDoc>(COLLECTIONS.payment, paymentSchema);

export interface RefundDoc extends Record<string, unknown> {
  paymentId: string;
  amountCents: number;
  reason: string;
}

const refundSchema = new Schema<RefundDoc>(
  {
    paymentId: { type: String, required: true },
    amountCents: { type: Number, required: true, min: 1 },
    /** Obligatorio: un reembolso sin motivo es indistinguible de un error de caja. */
    reason: { type: String, required: true },
  },
  { collection: COLLECTIONS.refund },
);

refundSchema.plugin(tenantPlugin);
refundSchema.plugin(baseFieldsPlugin);

export const RefundModel: Model<RefundDoc> =
  (mongoose.models[COLLECTIONS.refund] as Model<RefundDoc> | undefined) ??
  mongoose.model<RefundDoc>(COLLECTIONS.refund, refundSchema);
