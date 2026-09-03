import { z } from 'zod';

/**
 * Fuente única de validación de Notifications, compartida front/back (ADR-003).
 *
 * El módulo tiene una particularidad: es el único que le habla al socio cuando
 * el socio **no** está mirando la pantalla. Eso obliga a que todo lo de acá —
 * qué se manda, por qué canal, con qué plantilla — sea explícito y auditable,
 * porque la pregunta que llega a soporte no es "¿anduvo?", es "¿por qué no me
 * llegó?" (§2.1.14).
 */

/**
 * Los canales de Fase 1. Web Push y WhatsApp entran en Fase 2 (§2.1.14): el
 * enum crece, el resto del motor no cambia.
 */
export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;

export const notificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/**
 * Estados del envío. `sending` existe para que dos corridas del job que se
 * pisen no manden el mismo mail dos veces: reclamar el aviso es una escritura
 * atómica, no una lectura seguida de una escritura.
 */
export const NOTIFICATION_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;

export const notificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export type NotificationStatus = z.infer<typeof notificationStatusSchema>;

/** §14: los estados cambian solo por transición explícita y validada. */
export const NOTIFICATION_TRANSITIONS: Record<NotificationStatus, NotificationStatus[]> = {
  queued: ['sending'],
  // Vuelve a la cola cuando queda un reintento; termina cuando no queda ninguno.
  sending: ['sent', 'queued', 'failed'],
  sent: [],
  failed: [],
};

/**
 * Los avisos transaccionales del producto (§2.1.14). El motor los conoce a
 * todos desde F1-21 — necesita el catálogo para validar plantillas y
 * preferencias — pero quién los emite se cablea en F1-22.
 */
export const NOTIFICATION_EVENT_TYPES = [
  'booking.created',
  'booking.cancelled',
  'booking.waitlist_promoted',
  'session.reminder_24h',
  'session.reminder_1h',
  'session.cancelled',
  'session.coach_changed',
  'contract.expiring',
  'contract.expired',
  'charge.overdue',
  'payment.received',
] as const;

export const notificationEventTypeSchema = z.enum(NOTIFICATION_EVENT_TYPES);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

/**
 * Qué variables puede usar la plantilla de cada aviso.
 *
 * Está acá y no en el backend porque el editor del SMU las tiene que ofrecer
 * mientras escribe: una plantilla que se rechaza al guardar es peor experiencia
 * que una que nunca dejó escribir la variable que no existe.
 */
export const NOTIFICATION_VARIABLES: Record<NotificationEventType, readonly string[]> = {
  'booking.created': ['nombre', 'clase', 'fecha', 'hora', 'sede'],
  'booking.cancelled': ['nombre', 'clase', 'fecha', 'hora'],
  'booking.waitlist_promoted': ['nombre', 'clase', 'fecha', 'hora', 'plazo'],
  'session.reminder_24h': ['nombre', 'clase', 'fecha', 'hora', 'sede'],
  'session.reminder_1h': ['nombre', 'clase', 'hora', 'sede'],
  'session.cancelled': ['nombre', 'clase', 'fecha', 'hora', 'motivo'],
  'session.coach_changed': ['nombre', 'clase', 'fecha', 'hora'],
  'contract.expiring': ['nombre', 'pack', 'dias', 'vence'],
  'contract.expired': ['nombre', 'pack'],
  'charge.overdue': ['nombre', 'monto', 'vencimiento'],
  'payment.received': ['nombre', 'monto', 'fecha'],
};

/**
 * Los avisos que salen **aunque el usuario haya apagado el canal** (§2.1.14).
 * Son los de plata: que alguien no quiera recordatorios de clase no puede
 * significar que el centro no pueda avisarle que debe una cuota.
 */
export const CRITICAL_EVENT_TYPES = ['charge.overdue', 'payment.received'] as const;

export function isCriticalEventType(eventType: string): boolean {
  return (CRITICAL_EVENT_TYPES as readonly string[]).includes(eventType);
}

// ── Plantillas ──────────────────────────────────────────────────────────────

/**
 * Lo que el SMU edita. `subject` solo lo usa el mail; in-app muestra `body`
 * con el título del catálogo.
 */
export const saveTemplateSchema = z.object({
  eventType: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  subject: z.string().trim().min(1, 'Ponele un asunto.').max(160),
  body: z.string().trim().min(1, 'El mensaje no puede estar vacío.').max(2000),
  enabled: z.boolean().default(true),
});

export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

export const notificationTemplateSchema = z.object({
  publicId: z.string(),
  eventType: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  subject: z.string(),
  body: z.string(),
  enabled: z.boolean(),
  /** `true` mientras nadie la editó: es la que trae el producto de fábrica. */
  isDefault: z.boolean(),
  variables: z.array(z.string()),
});

export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

/** La vista previa resuelve las variables con datos de ejemplo (§2.1.14). */
export const previewTemplateSchema = saveTemplateSchema.pick({
  eventType: true,
  channel: true,
  subject: true,
  body: true,
});

export type PreviewTemplateInput = z.infer<typeof previewTemplateSchema>;

export const templatePreviewSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

export type TemplatePreview = z.infer<typeof templatePreviewSchema>;

// ── Preferencias ────────────────────────────────────────────────────────────

export const notificationPreferenceSchema = z.object({
  eventType: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  enabled: z.boolean(),
  /**
   * Los críticos se listan igual, en gris: esconderlos hace que parezca que se
   * pueden apagar y que la app los ignora.
   */
  critical: z.boolean(),
});

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const updatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        eventType: notificationEventTypeSchema,
        channel: notificationChannelSchema,
        enabled: z.boolean(),
      }),
    )
    .min(1, 'No mandaste ninguna preferencia.')
    .max(NOTIFICATION_EVENT_TYPES.length * NOTIFICATION_CHANNELS.length),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

// ── Avisos ──────────────────────────────────────────────────────────────────

/** Lo que ve el usuario en su campana (§2.1.14). */
export const notificationSchema = z.object({
  publicId: z.string(),
  eventType: notificationEventTypeSchema,
  channel: notificationChannelSchema,
  subject: z.string(),
  body: z.string(),
  status: notificationStatusSchema,
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  readAt: z.string().nullable(),
});

export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** El badge de la campana pide solo las no leídas. */
  unreadOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((valor) => valor === true || valor === 'true')
    .default(false),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/**
 * El registro de entregas para soporte (§2.1.14). Es la respuesta a "no me
 * llegó el aviso": qué se intentó, cuántas veces y con qué error.
 */
export const deliveryLogEntrySchema = notificationSchema.extend({
  userId: z.string(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  /** Cuándo se va a reintentar; `null` si ya terminó, bien o mal. */
  nextAttemptAt: z.string().nullable(),
});

export type DeliveryLogEntry = z.infer<typeof deliveryLogEntrySchema>;
