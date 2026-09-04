import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelos de Schedule. **Solo los usa el repositorio** (ADR-000 regla 1).
 *
 * Los indices `{ tenantId, venueId, active }` y `{ tenantId, venueId, startAt }`
 * viven en la migracion de F0-10; el unico `{ tenantId, templateId, startAt }`
 * que hace idempotente al job de materializacion entra con la migracion de
 * F1-12.
 */
export interface ClassTemplateDoc extends Record<string, unknown> {
  venueId: string;
  roomId: string;
  name: string;
  categoryId: string;
  durationMin: number;
  capacity?: number;
  coachId?: string;
  recurrence: {
    freq: string;
    byWeekday: number[];
    timeOfDay: string;
    interval: number;
    from: string;
    until?: string;
  };
  active: boolean;
}

const templateSchema = new Schema<ClassTemplateDoc>(
  {
    venueId: { type: String, required: true },
    roomId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    categoryId: { type: String, required: true },
    durationMin: { type: Number, required: true, min: 5 },
    capacity: { type: Number, required: false },
    coachId: { type: String, required: false },
    recurrence: {
      _id: false,
      freq: { type: String, required: true, default: 'weekly' },
      byWeekday: { type: [Number], required: true },
      timeOfDay: { type: String, required: true },
      interval: { type: Number, required: true, default: 1 },
      from: { type: String, required: true },
      until: { type: String, required: false },
    },
    active: { type: Boolean, required: true, default: true },
  },
  { collection: COLLECTIONS.classTemplate },
);

templateSchema.plugin(tenantPlugin);
templateSchema.plugin(baseFieldsPlugin);

export const ClassTemplateModel: Model<ClassTemplateDoc> =
  (mongoose.models[COLLECTIONS.classTemplate] as Model<ClassTemplateDoc> | undefined) ??
  mongoose.model<ClassTemplateDoc>(COLLECTIONS.classTemplate, templateSchema);

export interface ClassSessionDoc extends Record<string, unknown> {
  venueId: string;
  roomId: string;
  /** De que plantilla salio. Ausente en una clase suelta cargada a mano. */
  templateId?: string;
  name: string;
  categoryId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  /** Lo lleva Booking (F1-14) con un update atomico. */
  bookedCount: number;
  waitlistCount: number;
  coachId?: string;
  status: string;
}

const sessionSchema = new Schema<ClassSessionDoc>(
  {
    venueId: { type: String, required: true },
    roomId: { type: String, required: true },
    templateId: { type: String, required: false },
    name: { type: String, required: true },
    categoryId: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    capacity: { type: Number, required: true, min: 1 },
    bookedCount: { type: Number, required: true, default: 0, min: 0 },
    waitlistCount: { type: Number, required: true, default: 0, min: 0 },
    coachId: { type: String, required: false },
    status: { type: String, required: true, default: 'scheduled' },
  },
  { collection: COLLECTIONS.classSession },
);

sessionSchema.plugin(tenantPlugin);
sessionSchema.plugin(baseFieldsPlugin);

export const ClassSessionModel: Model<ClassSessionDoc> =
  (mongoose.models[COLLECTIONS.classSession] as Model<ClassSessionDoc> | undefined) ??
  mongoose.model<ClassSessionDoc>(COLLECTIONS.classSession, sessionSchema);
