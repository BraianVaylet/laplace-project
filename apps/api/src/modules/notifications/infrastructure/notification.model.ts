import mongoose, { Schema, type Model } from 'mongoose';
import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from '@laplace/schemas';
import { COLLECTIONS } from '../../../persistence/collections.js';
import { baseFieldsPlugin, tenantPlugin } from '../../../tenancy/plugin.js';

/**
 * Modelo de Mongoose de Notification (§5.2.2). **Solo lo usa el repositorio**
 * (ADR-000).
 *
 * Es la cola y el registro de entregas a la vez: la misma fila que espera para
 * salir es la que después contesta "no me llegó el aviso" (§2.1.14). Por eso
 * guarda el texto ya resuelto y no el `templateId` con los datos aparte —
 * cuando soporte mira, tiene que ver lo que la persona recibió, no lo que la
 * plantilla de hoy generaría.
 */
export interface NotificationDoc extends Record<string, unknown> {
  /** A quién. Es la cuenta, no la ficha de socio: la campana es del usuario. */
  userId: string;
  eventType: string;
  channel: string;
  /** Solo para email; in-app lo ignora. */
  subject: string;
  body: string;
  status: string;
  /** `{userId}:{evento}:{canal}:{origen}` — el único de la migración F1-21. */
  dedupeKey: string;
  /** Qué lo originó (la reserva, la clase, el cargo). Para el dedupe y soporte. */
  subjectId: string;
  /** Cuándo se puede mandar: ya corrido si caía en la ventana de silencio. */
  nextAttemptAt: Date | null;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  readAt: Date | null;
  /** El email al que salió, congelado: si el usuario lo cambia, el log no miente. */
  destination: string | null;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    userId: { type: String, required: true },
    eventType: { type: String, required: true },
    channel: { type: String, required: true, enum: NOTIFICATION_CHANNELS },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    status: { type: String, required: true, enum: NOTIFICATION_STATUSES, default: 'queued' },
    dedupeKey: { type: String, required: true },
    subjectId: { type: String, required: true },
    nextAttemptAt: { type: Date, required: false, default: null },
    attempts: { type: Number, required: true, default: 0 },
    lastError: { type: String, required: false, default: null },
    sentAt: { type: Date, required: false, default: null },
    readAt: { type: Date, required: false, default: null },
    destination: { type: String, required: false, default: null },
  },
  { collection: COLLECTIONS.notification },
);

notificationSchema.plugin(tenantPlugin);
notificationSchema.plugin(baseFieldsPlugin);

export const NotificationModel: Model<NotificationDoc> =
  (mongoose.models[COLLECTIONS.notification] as Model<NotificationDoc> | undefined) ??
  mongoose.model<NotificationDoc>(COLLECTIONS.notification, notificationSchema);
