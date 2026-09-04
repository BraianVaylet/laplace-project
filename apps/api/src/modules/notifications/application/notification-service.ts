import type { Temporal } from '@js-temporal/polyfill';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_TYPES,
  isCriticalEventType,
  type Notification,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationPreference,
  type NotificationTemplate,
  type SaveTemplateInput,
  type PreviewTemplateInput,
  type TemplatePreview,
  type UpdatePreferencesInput,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import { runWithTenant } from '../../../tenancy/context.js';
import {
  assertTransition,
  dedupeKeyOf,
  defaultTemplate,
  sampleValues,
  variablesFor,
} from '../domain/catalog.js';
import { isAllowed, nextAttempt, sendableAt } from '../domain/delivery.js';
import { assertRenderable, render } from '../domain/template.js';
import type { NotificationRepository } from '../infrastructure/notification.repository.js';
import type { NotificationPreferenceRepository } from '../infrastructure/preference.repository.js';
import type { NotificationTemplateRepository } from '../infrastructure/template.repository.js';
import type { NotificationDoc } from '../infrastructure/notification.model.js';
import type { NotificationMailer } from './ports.js';

export interface NotificationServiceDeps {
  notifications: NotificationRepository;
  templates: NotificationTemplateRepository;
  preferences: NotificationPreferenceRepository;
  mailer: NotificationMailer;
  now: () => Temporal.Instant;
}

/** Lo que necesita saber el motor para armar un aviso. */
export interface QueueRequest {
  eventType: NotificationEventType;
  /** La cuenta que lo recibe. Sin cuenta no hay aviso: se descarta, no falla. */
  userId: string;
  /** Para el canal email. `null` manda solo el in-app. */
  email: string | null;
  /** Qué lo originó: la reserva, la clase, el cargo. Parte de la clave de dedupe. */
  subjectId: string;
  /** Los valores de las variables de la plantilla. */
  values: Record<string, string>;
  /** La zona del centro: la ventana de silencio es la del socio, no la del server. */
  timeZone: string;
}

/**
 * El motor de avisos (§2.1.14).
 *
 * Encolar y enviar están separados a propósito: quien reserva no espera a que
 * salga el mail, y un proveedor caído no puede hacer fallar la reserva. Lo que
 * el flujo de negocio hace es dejar la fila; mandarla es problema del job.
 */
export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  // ── Encolar ───────────────────────────────────────────────────────────────

  /**
   * Deja el aviso en la cola, por cada canal que corresponda.
   *
   * Devuelve cuántos entraron: los que el usuario apagó, los que el SMU
   * desactivó y los que ya estaban encolados no cuentan, y ninguno de esos tres
   * casos es un error.
   */
  async queue(request: QueueRequest): Promise<number> {
    const preferencias = await this.deps.preferences.ofUser(request.userId);
    const ahora = this.deps.now();
    let encolados = 0;

    for (const channel of NOTIFICATION_CHANNELS) {
      if (channel === 'email' && !request.email) continue;
      if (!isAllowed(request.eventType, channel, preferencias)) continue;

      const plantilla = await this.templateOf(request.eventType, channel);
      if (!plantilla.enabled) continue;

      const creado = await this.deps.notifications.enqueue({
        userId: request.userId,
        eventType: request.eventType,
        channel,
        subject: this.safeRender(plantilla.subject, request.values),
        body: this.safeRender(plantilla.body, request.values),
        dedupeKey: dedupeKeyOf({
          userId: request.userId,
          eventType: request.eventType,
          channel,
          subjectId: request.subjectId,
        }),
        subjectId: request.subjectId,
        sendAt: this.sendAtFor(channel, ahora, request.timeZone),
        destination: channel === 'email' ? request.email : null,
      });

      if (creado) encolados += 1;
    }

    return encolados;
  }

  /**
   * La ventana de silencio se aplica al canal que **interrumpe**.
   *
   * El mail a las 3 AM despierta a alguien; la campana de la app no, y diferir
   * el in-app sería peor: quien reserva a las 23:00 tiene que ver su
   * confirmación al toque, no a las 8 de la mañana.
   */
  private sendAtFor(
    channel: NotificationChannel,
    now: Temporal.Instant,
    timeZone: string,
  ): Temporal.Instant {
    return channel === 'email' ? sendableAt(now, timeZone) : now;
  }

  /**
   * Resuelve la plantilla sin hacer fallar el aviso.
   *
   * Si falta un valor, sale el texto con el `{{hueco}}` en vez de no salir
   * nada: un recordatorio imperfecto le sirve más al socio que un silencio, y
   * el hueco se ve en el registro de entregas.
   */
  private safeRender(template: string, values: Record<string, string>): string {
    try {
      return render(template, values);
    } catch {
      return template;
    }
  }

  // ── Enviar ────────────────────────────────────────────────────────────────

  /**
   * Manda lo que ya se puede mandar. Lo corre el job `dispatchNotifications`.
   *
   * Recorre todos los centros porque el job es uno solo para la instancia, y
   * entra al contexto de cada tenant antes de tocar sus datos (ADR-000).
   */
  async dispatchDue(): Promise<number> {
    const ahora = this.deps.now();
    const pendientes = await this.deps.notifications.dueAcrossTenants(ahora);
    let enviados = 0;

    for (const aviso of pendientes) {
      enviados += await runWithTenant(
        {
          tenantId: String(aviso['tenantId']),
          userId: 'system:dispatchNotifications',
          requestId: `job-notify-${String(aviso['publicId'])}`,
        },
        () => this.dispatchOne(String(aviso['publicId'])),
      );
    }

    return enviados;
  }

  /**
   * 🔴 Un aviso, de punta a punta.
   *
   * El reclamo (`queued → sending`) es atómico: si otra corrida ya lo tomó,
   * acá vuelve `null` y no se manda dos veces.
   */
  private async dispatchOne(publicId: string): Promise<number> {
    const aviso = await this.deps.notifications.claim(publicId);
    if (!aviso) return 0;

    try {
      await this.deliver(aviso);
      assertTransition('sending', 'sent');
      await this.deps.notifications.markSent(publicId, this.deps.now());

      return 1;
    } catch (error) {
      await this.handleFailure(publicId, aviso.attempts, error);

      return 0;
    }
  }

  private async deliver(aviso: NotificationDoc): Promise<void> {
    // El in-app ya está entregado por existir: la fila **es** la notificación.
    if (aviso.channel !== 'email') return;

    if (!aviso.destination) {
      throw new AppError({
        code: 'LP-NOTF-500-001',
        status: 500,
        message: 'El aviso por mail no tiene destinatario.',
        meta: { notificationId: aviso['publicId'] },
      });
    }

    await this.deps.mailer.send({
      to: aviso.destination,
      subject: aviso.subject,
      body: aviso.body,
    });
  }

  /** Backoff mientras queden intentos; cola de fallidos cuando se agotan. */
  private async handleFailure(publicId: string, attempts: number, error: unknown): Promise<void> {
    const motivo = error instanceof Error ? error.message : String(error);
    const decision = nextAttempt(attempts, this.deps.now());

    if (decision.nextAttemptAt) {
      assertTransition('sending', 'queued');
      await this.deps.notifications.markRetry(publicId, decision.nextAttemptAt, motivo);

      return;
    }

    assertTransition('sending', 'failed');
    await this.deps.notifications.markFailed(publicId, motivo);
  }

  // ── Plantillas ────────────────────────────────────────────────────────────

  /** La que editó el centro, o la de fábrica si no editó nada. */
  private async templateOf(
    eventType: NotificationEventType,
    channel: NotificationChannel,
  ): Promise<{ subject: string; body: string; enabled: boolean }> {
    const propia = await this.deps.templates.of(eventType, channel);
    if (propia) {
      return { subject: propia.subject, body: propia.body, enabled: propia.enabled };
    }

    return { ...defaultTemplate(eventType), enabled: true };
  }

  /** Todo el catálogo, con lo que el centro cambió ya aplicado. */
  async templates(): Promise<NotificationTemplate[]> {
    const propias = await this.deps.templates.all();

    return NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
      NOTIFICATION_CHANNELS.map((channel) => {
        const propia = propias.find(
          (fila) => fila.eventType === eventType && fila.channel === channel,
        );
        const base = defaultTemplate(eventType);

        return {
          publicId: propia ? String(propia['publicId']) : `default:${eventType}:${channel}`,
          eventType,
          channel,
          subject: propia?.subject ?? base.subject,
          body: propia?.body ?? base.body,
          enabled: propia?.enabled ?? true,
          isDefault: !propia,
          variables: [...variablesFor(eventType)],
        };
      }),
    );
  }

  async saveTemplate(input: SaveTemplateInput): Promise<NotificationTemplate> {
    // Falla al guardar, que es cuando el SMU está mirando la pantalla y puede
    // arreglarlo — no cuando el aviso tenía que salirle a 200 socios.
    const disponibles = variablesFor(input.eventType);
    assertRenderable(input.subject, disponibles);
    assertRenderable(input.body, disponibles);

    const guardada = await this.deps.templates.save(input);

    return {
      publicId: String(guardada['publicId']),
      eventType: guardada.eventType,
      channel: guardada.channel,
      subject: guardada.subject,
      body: guardada.body,
      enabled: guardada.enabled,
      isDefault: false,
      variables: [...disponibles],
    };
  }

  /** La vista previa con datos de ejemplo (§2.1.14). */
  preview(input: PreviewTemplateInput): TemplatePreview {
    const disponibles = variablesFor(input.eventType);
    assertRenderable(input.subject, disponibles);
    assertRenderable(input.body, disponibles);

    const valores = sampleValues(input.eventType);

    return {
      subject: render(input.subject, valores),
      body: render(input.body, valores),
    };
  }

  // ── Preferencias ──────────────────────────────────────────────────────────

  /** El catálogo entero, con lo que el usuario apagó ya aplicado. */
  async preferencesOf(userId: string): Promise<NotificationPreference[]> {
    const propias = await this.deps.preferences.ofUser(userId);

    return NOTIFICATION_EVENT_TYPES.flatMap((eventType) =>
      NOTIFICATION_CHANNELS.map((channel) => {
        const propia = propias.find(
          (fila) => fila.eventType === eventType && fila.channel === channel,
        );
        const critical = isCriticalEventType(eventType);

        return {
          eventType,
          channel,
          // Los críticos se muestran encendidos siempre: apagarlos no hace nada.
          enabled: critical ? true : (propia?.enabled ?? true),
          critical,
        };
      }),
    );
  }

  async updatePreferences(
    userId: string,
    input: UpdatePreferencesInput,
  ): Promise<NotificationPreference[]> {
    for (const fila of input.preferences) {
      // Guardar el opt-out de un aviso crítico daría la idea de que se
      // respeta. Se ignora en silencio y la respuesta muestra la verdad.
      if (isCriticalEventType(fila.eventType)) continue;

      await this.deps.preferences.set({ userId, ...fila });
    }

    return this.preferencesOf(userId);
  }

  // ── Campana y soporte ─────────────────────────────────────────────────────

  async inboxOf(
    userId: string,
    query: { cursor?: string | undefined; limit?: number | undefined; unreadOnly?: boolean },
  ): Promise<{ items: Notification[]; nextCursor: string | null }> {
    const pagina = await this.deps.notifications.ofUser(userId, query);

    return { items: pagina.items.map(toResponse), nextCursor: pagina.nextCursor };
  }

  async unreadCountOf(userId: string): Promise<number> {
    return this.deps.notifications.unreadCountOf(userId);
  }

  async markRead(publicId: string, userId: string): Promise<boolean> {
    return this.deps.notifications.markRead(publicId, userId, this.deps.now());
  }

  /** El registro de entregas: la respuesta a "no me llegó el aviso" (§2.1.14). */
  async deliveryLog(
    filter: { userId?: string | undefined; status?: string | undefined },
    options: { cursor?: string | undefined; limit?: number | undefined },
  ) {
    const pagina = await this.deps.notifications.deliveryLog(filter, options);

    return {
      items: pagina.items.map((doc) => ({
        ...toResponse(doc),
        userId: doc.userId,
        attempts: doc.attempts,
        lastError: doc.lastError,
        nextAttemptAt: doc.nextAttemptAt ? doc.nextAttemptAt.toISOString() : null,
      })),
      nextCursor: pagina.nextCursor,
    };
  }
}

function toResponse(doc: NotificationDoc): Notification {
  return {
    publicId: String(doc['publicId']),
    eventType: doc.eventType as NotificationEventType,
    channel: doc.channel as NotificationChannel,
    subject: doc.subject,
    body: doc.body,
    status: doc.status as Notification['status'],
    createdAt: (doc['createdAt'] as Date).toISOString(),
    sentAt: doc.sentAt ? doc.sentAt.toISOString() : null,
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
  };
}
