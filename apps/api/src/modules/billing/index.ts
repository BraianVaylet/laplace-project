import { Temporal } from '@js-temporal/polyfill';
import type { AuditWriter } from '../../audit/audit-log.js';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { toBsonDate } from '../../persistence/bson-date.js';
import { runWithTenant } from '../../tenancy/context.js';
import type { JobDefinition } from '../../jobs/runner.js';
import {
  BillingService,
  type ContractSales,
  type MemberBalanceCache,
} from './application/billing-service.js';
import type { ChargeDoc } from './infrastructure/billing.model.js';
import {
  ChargeRepository,
  PaymentRepository,
  RefundRepository,
} from './infrastructure/billing.repository.js';
import { billingJobs } from './infrastructure/jobs.js';
import { VICTIM_CHARGE_DESCRIPTION, createBillingRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Billing. Es lo unico que puede tocar otro modulo:
 * los repositorios y los modelos se quedan adentro (ADR-003).
 */
export interface BillingModule {
  routes: ReturnType<typeof createBillingRoutes>;
  service: BillingService;
  /** El proceso diario de mora (§10). Lo registra el runner desde `index.ts`. */
  jobs: JobDefinition[];
}

export interface BillingModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  audit: AuditWriter;
  /** Refresca el saldo cacheado del socio. Lo contesta Members. */
  members: MemberBalanceCache;
  /** La zona horaria de la sede. El día de la caja es el del centro (§2.1.2). */
  venues: { timeZoneOf(venueId: string): Promise<string> };
  /** La venta de mostrador (F1-37). Sin esto, `POST /sales` contesta 422. */
  contracts?: ContractSales | undefined;
  now?: (() => Temporal.Instant) | undefined;
}

export function createBillingModule(deps: BillingModuleDeps): BillingModule {
  const charges = new ChargeRepository();
  const service = new BillingService({
    charges,
    payments: new PaymentRepository(),
    refunds: new RefundRepository(),
    events: deps.events,
    audit: deps.audit,
    members: deps.members,
    ...(deps.contracts ? { contracts: deps.contracts } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });

  /** Siembra un cargo del tenant victima para la suite de aislamiento (F0-05). */
  const seedVictim = async (victimTenantId: string) => {
    const memberId = 'mem_victima';
    const created = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        charges.create({
          memberId,
          venueId: 'ven_victima',
          amountCents: 6_000_000,
          paidCents: 0,
          currency: 'ARS',
          dueAt: toBsonDate(Temporal.Now.instant()),
          status: 'pending',
          description: VICTIM_CHARGE_DESCRIPTION,
        } as Partial<ChargeDoc>),
    );

    return { chargeId: String(created['publicId']), memberId };
  };

  return {
    routes: createBillingRoutes(service, deps.entitlements, deps.venues, seedVictim),
    service,
    jobs: billingJobs(service),
  };
}

export type { BillingService, MemberBalanceCache } from './application/billing-service.js';
