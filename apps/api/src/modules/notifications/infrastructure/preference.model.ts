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
 * El opt-out del usuario, por canal y por tipo de aviso (§2.1.14). **Solo lo
 * usa el repositorio**.
 *
 * Se guarda solo lo que la persona cambió: sin fila, se manda. Guardar las 22
 * combinaciones en el alta significaría que un aviso nuevo del producto le
 * llega apagado a todo el mundo.
 */
export interface NotificationPreferenceDoc extends Record<string, unknown> {
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

const preferenceSchema = new Schema<NotificationPreferenceDoc>(
  {
    userId: { type: String, required: true },
    eventType: { type: String, required: true, enum: NOTIFICATION_EVENT_TYPES },
    channel: { type: String, required: true, enum: NOTIFICATION_CHANNELS },
    enabled: { type: Boolean, required: true },
  },
  { collection: COLLECTIONS.notificationPreference },
);

preferenceSchema.plugin(tenantPlugin);
preferenceSchema.plugin(baseFieldsPlugin);

export const NotificationPreferenceModel: Model<NotificationPreferenceDoc> =
  (mongoose.models[COLLECTIONS.notificationPreference] as
    Model<NotificationPreferenceDoc> | undefined) ??
  mongoose.model<NotificationPreferenceDoc>(COLLECTIONS.notificationPreference, preferenceSchema);
