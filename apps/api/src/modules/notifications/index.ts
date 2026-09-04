import type { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import type { JobDefinition } from '../../jobs/runner.js';
import { runWithTenant } from '../../tenancy/context.js';
import { NotificationService } from './application/notification-service.js';
import { ReminderSender } from './application/reminders.js';
import { subscribeNotifications } from './application/subscriptions.js';
import type {
  ChargeLookup,
  ContractLookup,
  NotificationMailer,
  PaymentLookup,
  RecipientLookup,
  RosterLookup,
  SessionLookup,
  UpcomingSessionLookup,
  VenueLookup,
} from './application/ports.js';
import { notificationJobs } from './infrastructure/jobs.js';
import { NotificationRepository } from './infrastructure/notification.repository.js';
import { NotificationPreferenceRepository } from './infrastructure/preference.repository.js';
import { NotificationTemplateRepository } from './infrastructure/template.repository.js';
import { createNotificationRoutes, VICTIM_NOTIFICATION_SUBJECT } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Notifications. Es lo unico que puede tocar otro
 * modulo: los repositorios y los modelos se quedan adentro (ADR-003).
 *
 * Ningun modulo la usa, y eso es el punto: Notifications se engancha a los
 * eventos que los demas ya emiten, y nadie tiene que acordarse de avisarle.
 */
export interface NotificationModule {
  routes: ReturnType<typeof createNotificationRoutes>;
  service: NotificationService;
  jobs: JobDefinition[];
}

export interface NotificationModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  mailer: NotificationMailer;
  recipients: RecipientLookup;
  sessions: SessionLookup;
  venues: VenueLookup;
  roster: RosterLookup;
  contracts: ContractLookup;
  charges: ChargeLookup;
  payments: PaymentLookup;
  upcoming: UpcomingSessionLookup;
  now: () => Temporal.Instant;
}

export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  const service = new NotificationService({
    notifications: new NotificationRepository(),
    templates: new NotificationTemplateRepository(),
    preferences: new NotificationPreferenceRepository(),
    mailer: deps.mailer,
    now: deps.now,
  });

  subscribeNotifications(service, deps.events, {
    recipients: deps.recipients,
    sessions: deps.sessions,
    venues: deps.venues,
    roster: deps.roster,
    contracts: deps.contracts,
    charges: deps.charges,
    payments: deps.payments,
  });

  const reminders = new ReminderSender(
    service,
    {
      upcoming: deps.upcoming,
      recipients: deps.recipients,
      sessions: deps.sessions,
      venues: deps.venues,
      roster: deps.roster,
    },
    deps.now,
  );

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
    jobs: notificationJobs(service, reminders),
  };
}

export type { NotificationService } from './application/notification-service.js';
export type {
  ChargeLookup,
  ContractLookup,
  NotificationMailer,
  NotificationRecipient,
  OutgoingEmail,
  PaymentLookup,
  RecipientLookup,
  RosterLookup,
  SessionLookup,
  UpcomingSessionLookup,
  VenueLookup,
} from './application/ports.js';
export { createLoggingMailer } from './application/ports.js';
