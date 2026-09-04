import type { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { JobDefinition } from '../../jobs/runner.js';
import { MetricsService } from './application/metrics-service.js';
import type {
  BillingTotals,
  BookingCounts,
  MemberCounts,
  SessionCounts,
  VenueDirectory,
} from './application/ports.js';
import { EMPTY_COUNTS, dayKpisOf } from './domain/kpis.js';
import { metricsJobs } from './infrastructure/jobs.js';
import { MetricsDailyRepository } from './infrastructure/metrics-daily.repository.js';
import {
  createMetricsRoutes,
  VICTIM_INCOME_CENTS,
  VICTIM_VENUE_ID,
} from './infrastructure/routes.js';
import { runWithTenant } from '../../tenancy/context.js';

/**
 * Interfaz publica del modulo Metrics. Es lo unico que puede tocar otro modulo:
 * los repositorios y los modelos se quedan adentro (ADR-003).
 */
export interface MetricsModule {
  routes: ReturnType<typeof createMetricsRoutes>;
  service: MetricsService;
  jobs: JobDefinition[];
}

export interface MetricsModuleDeps {
  entitlements: EntitlementsLoader;
  venues: VenueDirectory;
  sessions: SessionCounts;
  bookings: BookingCounts;
  members: MemberCounts;
  billing: BillingTotals;
  now: () => Temporal.Instant;
}

export function createMetricsModule(deps: MetricsModuleDeps): MetricsModule {
  const service = new MetricsService({
    metrics: new MetricsDailyRepository(),
    venues: deps.venues,
    sessions: deps.sessions,
    bookings: deps.bookings,
    members: deps.members,
    billing: deps.billing,
    now: deps.now,
  });

  /**
   * Siembra los KPIs de una sede del tenant victima, para la suite de F0-05.
   * El ingreso es un numero imposible de confundir: si aparece en la respuesta
   * del atacante, hay fuga.
   */
  const seedVictim = async (victimTenantId: string) => {
    await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        new MetricsDailyRepository().upsertDay(
          VICTIM_VENUE_ID,
          '2026-03-01',
          dayKpisOf({ ...EMPTY_COUNTS, incomeCents: VICTIM_INCOME_CENTS }),
        ),
    );

    return { venueId: VICTIM_VENUE_ID };
  };

  return {
    routes: createMetricsRoutes(service, deps.entitlements, seedVictim),
    service,
    jobs: metricsJobs(service),
  };
}

export type { MetricsService } from './application/metrics-service.js';
export type {
  BillingTotals,
  BookingCounts,
  MemberCounts,
  SessionCounts,
  VenueDirectory,
} from './application/ports.js';
