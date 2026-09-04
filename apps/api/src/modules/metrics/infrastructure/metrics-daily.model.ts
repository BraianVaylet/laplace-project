import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de MetricsDaily (§5.2.2). **Solo lo usa el repositorio**
 * (ADR-000).
 *
 * Una fila por `(tenantId, venueId, fecha)`, con el único que la migración base
 * ya declara: es lo que hace idempotente al job — corre dos veces sobre el
 * mismo día y sobreescribe en vez de duplicar.
 *
 * La fecha se guarda como texto `YYYY-MM-DD` y no como `Date` a propósito: es
 * **el día del centro**, no un instante. Guardarla como `Date` obligaría a
 * elegir una hora, y esa hora sería medianoche de alguna zona — la del
 * servidor, casi seguro.
 */
export interface MetricsDailyDoc extends Record<string, unknown> {
  venueId: string;
  date: string;
  activeMembers: number;
  attendances: number;
  noShows: number;
  lateCancels: number;
  bookings: number;
  capacity: number;
  sessions: number;
  incomeCents: number;
  chargedCents: number;
  overdueCents: number;
  utilization: number;
  noShowRate: number;
}

const metricsDailySchema = new Schema<MetricsDailyDoc>(
  {
    venueId: { type: String, required: true },
    date: { type: String, required: true },
    activeMembers: { type: Number, required: true, default: 0 },
    attendances: { type: Number, required: true, default: 0 },
    noShows: { type: Number, required: true, default: 0 },
    lateCancels: { type: Number, required: true, default: 0 },
    bookings: { type: Number, required: true, default: 0 },
    capacity: { type: Number, required: true, default: 0 },
    sessions: { type: Number, required: true, default: 0 },
    incomeCents: { type: Number, required: true, default: 0 },
    chargedCents: { type: Number, required: true, default: 0 },
    overdueCents: { type: Number, required: true, default: 0 },
    utilization: { type: Number, required: true, default: 0 },
    noShowRate: { type: Number, required: true, default: 0 },
  },
  { collection: COLLECTIONS.metricsDaily },
);

metricsDailySchema.plugin(tenantPlugin);
metricsDailySchema.plugin(baseFieldsPlugin);

export const MetricsDailyModel: Model<MetricsDailyDoc> =
  (mongoose.models[COLLECTIONS.metricsDaily] as Model<MetricsDailyDoc> | undefined) ??
  mongoose.model<MetricsDailyDoc>(COLLECTIONS.metricsDaily, metricsDailySchema);
