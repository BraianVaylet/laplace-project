import type { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import type { JobDefinition } from '../../jobs/runner.js';
import { runWithTenant } from '../../tenancy/context.js';
import { NotificationService } from './application/notification-service.js';
import type { NotificationMailer, RecipientLookup } from './application/ports.js';
import { fechaLarga, horaDe } from './domain/format.js';
import { notificationJobs } from './infrastructure/jobs.js';
import { NotificationRepository } from './infrastructure/notification.repository.js';
import { NotificationPreferenceRepository } from './infrastructure/preference.repository.js';
import { NotificationTemplateRepository } from './infrastructure/template.repository.js';
import { createNotificationRoutes, VICTIM_NOTIFICATION_SUBJECT } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Notifications. Es lo unico que puede tocar otro
 * modulo: los repositorios y los modelos se quedan adentro (ADR-003).
 */
export interface NotificationModule {
  routes: ReturnType<typeof createNotificationRoutes>;
  service: NotificationService;
  jobs: JobDefinition[];
}

/** La clase, como la necesita un aviso. La contesta Schedule (ADR-003). */
export interface NotificationSessionLookup {
  find(sessionId: string): Promise<{
    name: string;
    venueId: string;
    startAt: Temporal.Instant;
  } | null>;
}

/** La sede, como la necesita un aviso: su nombre y su zona horaria. */
export interface NotificationVenueLookup {
  find(venueId: string): Promise<{ name: string; timeZone: string } | null>;
}

export interface NotificationModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  mailer: NotificationMailer;
  recipients: RecipientLookup;
  sessions: NotificationSessionLookup;
  venues: NotificationVenueLookup;
  now: () => Temporal.Instant;
}

/** Sin sede conocida, el aviso se arma en hora argentina y no en UTC. */
const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  const service = new NotificationService({
    notifications: new NotificationRepository(),
    templates: new NotificationTemplateRepository(),
    preferences: new NotificationPreferenceRepository(),
    mailer: deps.mailer,
    now: deps.now,
  });

  /**
   * 🔴 La confirmación de reserva (§2.1.14).
   *
   * Va por el bus y no por una llamada de Booking: la reserva ya está hecha
   * cuando esto corre, y si el aviso falla, la reserva sigue existiendo. Booking
   * no sabe que Notifications existe (ADR-003).
   */
  deps.events.on('booking.created', async ({ bookingId, sessionId, memberId, venueId }) => {
    const destinatario = await deps.recipients.byMemberId(memberId);
    // Un walk-in sin cuenta no tiene a dónde recibir nada. No es un error.
    if (!destinatario) return;

    const clase = await deps.sessions.find(sessionId);
    if (!clase) return;

    const sede = await deps.venues.find(venueId);
    const timeZone = sede?.timeZone ?? DEFAULT_TIME_ZONE;
    const local = clase.startAt.toZonedDateTimeISO(timeZone);

    await service.queue({
      eventType: 'booking.created',
      userId: destinatario.userId,
      email: destinatario.email,
      subjectId: bookingId,
      timeZone,
      values: {
        nombre: destinatario.name,
        clase: clase.name,
        fecha: fechaLarga(local),
        hora: horaDe(local),
        sede: sede?.name ?? 'el centro',
      },
    });
  });

  /** Siembra un aviso del tenant victima, para la suite de aislamiento (F0-05). */
  let sembrados = 0;
  const seedVictim = async (victimTenantId: string) => {
    const n = ++sembrados;

    return runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      async () => {
        const repo = new NotificationRepository();
        const aviso = await repo.enqueue({
          userId: `usr_victima_${n}`,
          eventType: 'booking.created',
          channel: 'in_app',
          subject: VICTIM_NOTIFICATION_SUBJECT,
          body: VICTIM_NOTIFICATION_SUBJECT,
          dedupeKey: `isolation:${n}`,
          subjectId: `bkg_isolation_${n}`,
          sendAt: deps.now(),
          destination: null,
        });

        return { notificationId: aviso ? String(aviso['publicId']) : `ntf_${n}` };
      },
    );
  };

  return {
    routes: createNotificationRoutes(service, deps.entitlements, seedVictim),
    service,
    jobs: notificationJobs(service),
  };
}

export type { NotificationService } from './application/notification-service.js';
export type {
  NotificationMailer,
  NotificationRecipient,
  OutgoingEmail,
  RecipientLookup,
} from './application/ports.js';
export { createLoggingMailer } from './application/ports.js';
