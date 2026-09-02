import { Temporal } from '@js-temporal/polyfill';
import type { AuditWriter } from '../../audit/audit-log.js';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { toBsonDate } from '../../persistence/bson-date.js';
import { runWithTenant } from '../../tenancy/context.js';
import {
  ContractService,
  type ProductCatalog,
  type VenueClock,
} from './application/contract-service.js';
import type { ContractDoc } from './infrastructure/contract.model.js';
import { ContractRepository } from './infrastructure/contract.repository.js';
import { VICTIM_CONTRACT_PRODUCT, createContractRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Contracts. Es lo unico que puede tocar otro
 * modulo: el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface ContractsModule {
  routes: ReturnType<typeof createContractRoutes>;
  service: ContractService;
}

export interface ContractsModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  audit: AuditWriter;
  products: ProductCatalog;
  venues: VenueClock;
  now?: (() => Temporal.Instant) | undefined;
}

export function createContractsModule(deps: ContractsModuleDeps): ContractsModule {
  const contracts = new ContractRepository();
  const service = new ContractService({
    contracts,
    products: deps.products,
    venues: deps.venues,
    events: deps.events,
    audit: deps.audit,
    ...(deps.now ? { now: deps.now } : {}),
  });

  /** Siembra un contrato del tenant victima para la suite de aislamiento (F0-05). */
  const seedVictimContract = async (victimTenantId: string) => {
    const created = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        contracts.create({
          memberId: 'mem_victima',
          productId: 'prd_victima',
          venueId: 'ven_victima',
          productType: 'class_pack',
          productName: VICTIM_CONTRACT_PRODUCT,
          priceSnapshotCents: 6_000_000,
          currency: 'ARS',
          creditsTotal: 8,
          creditsUsed: 0,
          allowedCategories: [],
          allowedTimeRanges: [],
          startsAt: toBsonDate(Temporal.Now.instant()),
          endsAt: toBsonDate(Temporal.Now.instant().add({ hours: 24 * 30 })),
          status: 'active',
          autoRenew: false,
        } as Partial<ContractDoc>),
    );

    return String(created['publicId']);
  };

  return {
    routes: createContractRoutes(service, deps.entitlements, seedVictimContract),
    service,
  };
}

export type {
  ContractService,
  ProductCatalog,
  VenueClock,
} from './application/contract-service.js';
