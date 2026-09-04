import type { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { JobDefinition } from '../../jobs/runner.js';
import { DashboardService } from './application/dashboard-service.js';
import { MetricsService } from './application/metrics-service.js';
import type {
  AlertMemberLookup,
  BillingTotals,
  BookingCounts,
  ContractAlertLookup,
  DashboardSessionLookup,
  MemberCounts,
  SessionCounts,
  SessionOccupancy,
  VenueDirectory,
  WaiverAlertLookup,
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
  dashboard: DashboardService;
  jobs: JobDefinition[];
}

export interface MetricsModuleDeps {
  entitlements: EntitlementsLoader;
  venues: VenueDirectory;
  sessions: SessionCounts;
  bookings: BookingCounts;
  members: MemberCounts;
  billing: BillingTotals;
  /** Lo que suma el tablero del dia (F1-24) sobre lo que ya usa el job. */
  dashboardSessions: DashboardSessionLookup;
  occupancy: SessionOccupancy;
  alertMembers: AlertMemberLookup;
  alertContracts: ContractAlertLookup;
  waivers: WaiverAlertLookup;
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

  const dashboard = new DashboardService({
    venues: deps.venues,
    sessions: deps.dashboardSessions,
    occupancy: deps.occupancy,
    members: deps.alertMembers,
    contracts: deps.alertContracts,
    waivers: deps.waivers,
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
    routes: createMetricsRoutes(service, dashboard, deps.entitlements, seedVictim),
    service,
    dashboard,
    jobs: metricsJobs(service),
  };
}

export type { DashboardService } from './application/dashboard-service.js';
export type { MetricsService } from './application/metrics-service.js';
export type {
  BillingTotals,
  BookingCounts,
  MemberCounts,
  SessionCounts,
  VenueDirectory,
} from './application/ports.js';
