import {
  NOTIFICATION_TRANSITIONS,
  NOTIFICATION_VARIABLES,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationStatus,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * Las plantillas que trae el producto de fábrica.
 *
 * Existen para que el motor sirva desde el primer día: un centro que todavía no
 * entró a la pantalla de plantillas tiene que poder mandar la confirmación de
 * reserva igual. El SMU las edita cuando quiere y ahí pisan a estas (§2.1.14).
 *
 * Están en es-AR y en segunda persona porque el que las lee es el socio, no el
 * sistema.
 */
export interface TemplateContent {
  subject: string;
  body: string;
}

const DEFAULTS: Record<NotificationEventType, TemplateContent> = {
  'booking.created': {
    subject: 'Reservaste {{clase}}',
    body: 'Hola {{nombre}}, reservaste {{clase}} para el {{fecha}} a las {{hora}} en {{sede}}. ¡Te esperamos!',
  },
  'booking.cancelled': {
    subject: 'Cancelaste {{clase}}',
    body: 'Hola {{nombre}}, cancelaste {{clase}} del {{fecha}} a las {{hora}}.',
  },
  'booking.waitlist_promoted': {
    subject: 'Se liberó un lugar en {{clase}}',
    body: 'Hola {{nombre}}, se liberó un lugar en {{clase}} del {{fecha}} a las {{hora}}. Confirmá antes de {{plazo}} o el lugar pasa al siguiente.',
  },
  'session.reminder_24h': {
    subject: 'Mañana tenés {{clase}}',
    body: 'Hola {{nombre}}, mañana {{fecha}} a las {{hora}} tenés {{clase}} en {{sede}}.',
  },
  'session.reminder_1h': {
    subject: '{{clase}} en 1 hora',
    body: 'Hola {{nombre}}, tu clase de {{clase}} es a las {{hora}} en {{sede}}.',
  },
  'session.cancelled': {
    subject: 'Se canceló {{clase}}',
    body: 'Hola {{nombre}}, se canceló {{clase}} del {{fecha}} a las {{hora}}. Motivo: {{motivo}}. Te devolvimos el crédito.',
  },
  'session.coach_changed': {
    subject: 'Cambió el coach de {{clase}}',
    body: 'Hola {{nombre}}, {{clase}} del {{fecha}} a las {{hora}} la va a dar {{coach}}.',
  },
  'contract.expiring': {
    subject: 'Tu {{pack}} vence en {{dias}} días',
    body: 'Hola {{nombre}}, tu {{pack}} vence el {{vence}}. Renovalo para no quedarte sin clases.',
  },
  'contract.expired': {
    subject: 'Se venció tu {{pack}}',
    body: 'Hola {{nombre}}, se venció tu {{pack}}. Pasá por recepción o escribinos para renovarlo.',
  },
  'charge.overdue': {
    subject: 'Tenés un pago pendiente',
    body: 'Hola {{nombre}}, tenés {{monto}} pendiente desde el {{vencimiento}}.',
  },
  'payment.received': {
    subject: 'Recibimos tu pago',
    body: 'Hola {{nombre}}, registramos tu pago de {{monto}} del {{fecha}}. ¡Gracias!',
  },
};

export function defaultTemplate(eventType: NotificationEventType): TemplateContent {
  return DEFAULTS[eventType];
}

/** Las variables que este aviso ofrece, para validar la plantilla y el editor. */
export function variablesFor(eventType: NotificationEventType): readonly string[] {
  return NOTIFICATION_VARIABLES[eventType];
}

/**
 * Datos de mentira para la vista previa. El SMU tiene que ver cómo queda el
 * aviso **antes** de que le llegue a 200 socios.
 */
const SAMPLES: Record<string, string> = {
  nombre: 'Micaela',
  clase: 'Funcional',
  fecha: 'lunes 9 de marzo',
  hora: '19:00',
  sede: 'Box Toro Centro',
  plazo: 'las 18:30',
  motivo: 'corte de luz',
  coach: 'Julián',
  pack: 'Pack 8 clases',
  dias: '3',
  vence: '12 de marzo',
  monto: '$18.000',
  vencimiento: '1 de marzo',
};

export function sampleValues(eventType: NotificationEventType): Record<string, string> {
  return Object.fromEntries(
    variablesFor(eventType).map((nombre) => [nombre, SAMPLES[nombre] ?? nombre]),
  );
}

/**
 * §14: los estados cambian solo por transición explícita y validada. Acá el
 * riesgo concreto es mandar dos veces el mismo mail — un `sent` que vuelve a
 * `queued` es exactamente eso.
 */
export function assertTransition(from: NotificationStatus, to: NotificationStatus): void {
  if (NOTIFICATION_TRANSITIONS[from].includes(to)) return;

  throw new AppError({
    code: 'LP-NOTF-500-001',
    status: 500,
    message: `No se puede pasar un aviso de ${from} a ${to}.`,
    meta: { from, to },
  });
}

/**
 * La clave con la que se deduplica (§2.1.14): mismo destinatario, mismo evento,
 * mismo canal, misma cosa que lo originó. Dos jobs que se pisan encolando el
 * recordatorio de la misma clase escriben la misma clave y el único de Mongo
 * deja pasar uno solo.
 */
export function dedupeKeyOf(input: {
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  subjectId: string;
}): string {
  return `${input.userId}:${input.eventType}:${input.channel}:${input.subjectId}`;
}
