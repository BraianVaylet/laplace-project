import mongoose, { Schema, type Model } from 'mongoose';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  type NotificationChannel,
  type NotificationEventType,
} from '@laplace/schemas';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Plantilla editada por el SMU (§2.1.14). **Solo lo usa el repositorio**.
 *
 * Solo existe fila para lo que el centro cambió: mientras no toque nada, el
 * motor usa la de fábrica (`domain/catalog.ts`). Así una plantilla nueva que
 * agregue el producto llega sola a todos los centros, en vez de quedar pisada
 * por una copia que alguien guardó sin cambiar nada.
 */
export interface NotificationTemplateDoc extends Record<string, unknown> {
  eventType: NotificationEventType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  /** El SMU puede apagar un aviso entero sin borrar lo que escribió. */
  enabled: boolean;
}

const templateSchema = new Schema<NotificationTemplateDoc>(
  {
    eventType: { type: String, required: true, enum: NOTIFICATION_EVENT_TYPES },
    channel: { type: String, required: true, enum: NOTIFICATION_CHANNELS },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    enabled: { type: Boolean, required: true, default: true },
  },
  { collection: COLLECTIONS.notificationTemplate },
);

templateSchema.plugin(tenantPlugin);
templateSchema.plugin(baseFieldsPlugin);

export const NotificationTemplateModel: Model<NotificationTemplateDoc> =
  (mongoose.models[COLLECTIONS.notificationTemplate] as
    Model<NotificationTemplateDoc> | undefined) ??
  mongoose.model<NotificationTemplateDoc>(COLLECTIONS.notificationTemplate, templateSchema);
