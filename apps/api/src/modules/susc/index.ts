import type { Temporal } from '@js-temporal/polyfill';
import { Hono } from 'hono';
import type { AppEnv } from '../../app.js';
import type { AuditWriter } from '../../audit/audit-log.js';
import type { DomainEventBus } from '../../events/bus.js';
import type { JobDefinition } from '../../jobs/runner.js';
import { SuscService } from './application/susc-service.js';
import type { ErrorEventStore } from '../../observability/error-events.js';
import { NULL_ERROR_EVENT_STORE } from '../../observability/error-events.js';
import type {
  JobRunLookup,
  OrganizationCreator,
  PlanLimitsLookup,
  UsageLookup,
} from './application/ports.js';
import { PlanRepository, SubscriptionRepository } from './infrastructure/susc.repository.js';
import { createSauRoutes, createSuscRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Suscriptors/Suscriptions (ADR-003).
 *
 * Es el unico modulo que **no** es de un centro: sus datos son sobre los
 * centros. Por eso sus colecciones no llevan `tenantId` y sus rutas de SAU van
 * bajo `/api/v1/admin`.
 */
export interface SuscModule {
  routes: Hono<AppEnv>;
  service: SuscService;
  jobs: JobDefinition[];
}

export interface SuscModuleDeps {
  organizations: OrganizationCreator;
  usage: UsageLookup;
  limits: PlanLimitsLookup;
  audit: AuditWriter;
  events: DomainEventBus;
  /**
   * De donde sale el panel de soporte (§11.3). Sin el, el panel abre vacio: un
   * registro de errores no puede ser requisito para que la app levante.
   */
  errorEvents?: ErrorEventStore | undefined;
  /** Las corridas de job fallidas. Sin el, el panel las muestra vacias. */
  jobRuns?: JobRunLookup | undefined;
  now: () => Temporal.Instant;
}

export function createSuscModule(deps: SuscModuleDeps): SuscModule {
  const service = new SuscService({
    subscriptions: new SubscriptionRepository(),
    plans: new PlanRepository(),
    organizations: deps.organizations,
    usage: deps.usage,
    limits: deps.limits,
    audit: deps.audit,
    events: deps.events,
    errorEvents: deps.errorEvents ?? NULL_ERROR_EVENT_STORE,
    jobRuns: deps.jobRuns ?? { failedSince: () => Promise.resolve([]) },
    now: deps.now,
  });

  const routes = new Hono<AppEnv>();
  routes.route('/', createSuscRoutes(service));
  routes.route('/', createSauRoutes(service));

  return {
    routes,
    service,
    jobs: [
      {
        /**
         * Cierra los trials vencidos (§2.1.3). A las 04:00, después de las
         * métricas: el trial que se vence hoy se cuenta en el día de ayer.
         *
         * Pasa a `suspended` y **no borra nada**. Es idempotente: el que ya
         * está suspendido no vuelve a aparecer en la consulta.
         */
        name: 'expireTrials',
        cron: '0 4 * * *',
        lockTtlSeconds: 300,
        handler: async () => {
          await service.expireTrials();
        },
      },
      {
        /**
         * Aplica los downgrades cuando termina el ciclo pagado (§2.1.4). Quien
         * pagó el mes de Pro tiene derecho a usarlo hasta el último día.
         */
        name: 'applyPendingPlanChanges',
        cron: '15 4 * * *',
        lockTtlSeconds: 300,
        handler: async () => {
          await service.applyPendingPlanChanges();
        },
      },
    ],
  };
}

export type { SuscService } from './application/susc-service.js';
export type {
  JobRunLookup,
  OrganizationCreator,
  PlanLimitsLookup,
  UsageLookup,
} from './application/ports.js';
export { PlanRepository, SubscriptionRepository } from './infrastructure/susc.repository.js';
