import type { Temporal } from '@js-temporal/polyfill';
import { runWithTenant } from '../../tenancy/context.js';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { WaiverService, type WaiverMemberLookup } from './application/waiver-service.js';
import { ConsentRepository } from './infrastructure/consent.repository.js';
import { LegalDocumentRepository } from './infrastructure/legal-document.repository.js';
import {
  createWaiverRoutes,
  VICTIM_DOCUMENT_TITLE,
  type MemberResolver,
} from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Waivers. Es lo unico que puede tocar otro
 * modulo: los repositorios y los modelos se quedan adentro (ADR-003).
 */
export interface WaiverModule {
  routes: ReturnType<typeof createWaiverRoutes>;
  service: WaiverService;
}

export interface WaiverModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  members: WaiverMemberLookup;
  resolveMember: MemberResolver;
  now: () => Temporal.Instant;
}

export function createWaiverModule(deps: WaiverModuleDeps): WaiverModule {
  const service = new WaiverService({
    documents: new LegalDocumentRepository(),
    consents: new ConsentRepository(),
    members: deps.members,
    events: deps.events,
    now: deps.now,
  });

  /** Siembra un documento del tenant victima, para la suite de aislamiento (F0-05). */
  const seedVictim = async (victimTenantId: string) => {
    const documento = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        service.publish({
          type: 'terms',
          title: VICTIM_DOCUMENT_TITLE,
          contentHtml: '<p>Contenido del otro centro.</p>',
          required: true,
        }),
    );

    return { documentId: documento.publicId };
  };

  return {
    routes: createWaiverRoutes(service, deps.entitlements, deps.resolveMember, seedVictim),
    service,
  };
}

export type {
  WaiverService,
  WaiverMemberLookup,
  RequestContext,
} from './application/waiver-service.js';
