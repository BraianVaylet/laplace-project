import { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import type { JobDefinition } from '../../jobs/runner.js';
import { toBsonDate } from '../../persistence/bson-date.js';
import { runWithTenant } from '../../tenancy/context.js';
import type { AuditWriter } from '../../audit/audit-log.js';
import {
  ScheduleService,
  type RoomLookup,
  type SessionBookingReleaser,
  type VenueLookup,
} from './application/schedule-service.js';
import { scheduleJobs } from './infrastructure/jobs.js';
import type { ClassSessionDoc, ClassTemplateDoc } from './infrastructure/schedule.model.js';
import {
  ClassSessionRepository,
  ClassTemplateRepository,
  VenueClosureRepository,
} from './infrastructure/schedule.repository.js';
import { VICTIM_TEMPLATE_NAME, createScheduleRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Schedule. Es lo unico que puede tocar otro modulo:
 * los repositorios y los modelos se quedan adentro (ADR-003).
 */
export interface ScheduleModule {
  routes: ReturnType<typeof createScheduleRoutes>;
  service: ScheduleService;
  jobs: JobDefinition[];
}

export interface ScheduleModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  audit: AuditWriter;
  rooms: RoomLookup;
  venues: VenueLookup;
  /** Lo contesta Booking (F1-14). Hasta entonces cancelar no libera reservas. */
  bookings?: SessionBookingReleaser | undefined;
  now?: (() => Temporal.Instant) | undefined;
}

export function createScheduleModule(deps: ScheduleModuleDeps): ScheduleModule {
  const templates = new ClassTemplateRepository();
  const sessions = new ClassSessionRepository();
  const closures = new VenueClosureRepository();
  const service = new ScheduleService({
    templates,
    sessions,
    closures,
    rooms: deps.rooms,
    venues: deps.venues,
    events: deps.events,
    audit: deps.audit,
    ...(deps.bookings ? { bookings: deps.bookings } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });

  /** Siembra una plantilla y una clase del tenant victima, para F0-05. */
  const seedVictim = async (victimTenantId: string) => {
    const context = {
      tenantId: victimTenantId,
      userId: 'usr_isolation_seed',
      requestId: 'req-isolation-seed',
    };

    const template = await runWithTenant(context, () =>
      templates.create({
        venueId: 'ven_victima',
        roomId: 'rom_victima',
        name: VICTIM_TEMPLATE_NAME,
        categoryId: 'funcional',
        durationMin: 60,
        recurrence: {
          freq: 'weekly',
          byWeekday: [1],
          timeOfDay: '07:00',
          interval: 1,
          from: '2026-01-01',
        },
        active: true,
      } as Partial<ClassTemplateDoc>),
    );

    const session = await runWithTenant(context, () =>
      sessions.create({
        venueId: 'ven_victima',
        roomId: 'rom_victima',
        name: VICTIM_TEMPLATE_NAME,
        categoryId: 'funcional',
        startAt: toBsonDate(Temporal.Now.instant().add({ hours: 24 })),
        endAt: toBsonDate(Temporal.Now.instant().add({ hours: 25 })),
        capacity: 16,
        bookedCount: 0,
        waitlistCount: 0,
        status: 'scheduled',
      } as Partial<ClassSessionDoc>),
    );

    return {
      templateId: String(template['publicId']),
      sessionId: String(session['publicId']),
    };
  };

  return {
    routes: createScheduleRoutes(service, deps.entitlements, seedVictim),
    service,
    jobs: scheduleJobs(service),
  };
}

export type {
  ScheduleService,
  RoomLookup,
  SessionBookingReleaser,
  VenueLookup,
} from './application/schedule-service.js';
