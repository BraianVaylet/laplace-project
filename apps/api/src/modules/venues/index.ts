import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { VenueService } from './application/venue-service.js';
import { VenueRepository } from './infrastructure/venue.repository.js';
import { createVenueRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Venues. Es lo unico que puede tocar otro modulo:
 * el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface VenuesModule {
  routes: ReturnType<typeof createVenueRoutes>;
  service: VenueService;
}

export function createVenuesModule(deps: {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
}): VenuesModule {
  const service = new VenueService(new VenueRepository(), deps.events);

  return { routes: createVenueRoutes(service, deps.entitlements), service };
}

export type { VenueService } from './application/venue-service.js';
