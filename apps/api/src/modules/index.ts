import { Hono } from 'hono';
import type { Temporal } from '@js-temporal/polyfill';
import type { Logger } from 'pino';
import type { AppEnv } from '../app.js';
import type { EntitlementsLoader } from '../entitlements/middleware.js';
import type { DomainEventBus } from '../events/bus.js';
import { createMembersModule, type OrganizationMembershipPort } from './members/index.js';
import { createProductsModule } from './products/index.js';
import { createRoomsModule, type FutureSessionCounter } from './rooms/index.js';
import { createVenuesModule } from './venues/index.js';

export interface ModuleDeps {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
  logger: Logger;
  /**
   * Cuantas sesiones futuras tiene una sala. Lo va a contestar Schedule (F1-12);
   * hasta entonces el default responde 0 y el bloqueo de borrado no aplica.
   */
  sessions?: FutureSessionCounter | undefined;
  /** Hoy en `YYYY-MM-DD`. Se inyecta para poder testear la mayoria de edad. */
  today?: (() => string) | undefined;
  /** Reloj del canje de codigos. Se inyecta para probar el vencimiento sin esperar. */
  now?: (() => Temporal.Instant) | undefined;
  /**
   * Suma un usuario a la organizacion de un centro. Lo implementa Better Auth
   * desde `index.ts`: los modulos no conocen la libreria de identidad.
   */
  memberships: OrganizationMembershipPort;
}

/**
 * Punto de composicion del monolito modular. Cada modulo se arma aca y expone
 * sus rutas; nadie importa el modelo ni el repositorio de otro (ADR-003).
 *
 * Los modulos que dependen de otro reciben su **interfaz**, no su
 * implementacion: Rooms pregunta si una sede existe a traves de `VenueLookup`,
 * que hoy contesta Venues y mañana podria contestar otra cosa.
 */
export function createModuleRoutes(deps: ModuleDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  const venues = createVenuesModule(deps);
  const rooms = createRoomsModule({
    ...deps,
    venues: { exists: (venueId) => venues.service.exists(venueId) },
  });

  const members = createMembersModule(deps);
  const products = createProductsModule(deps);

  routes.route('/', venues.routes);
  routes.route('/', rooms.routes);
  routes.route('/', members.routes);
  routes.route('/', products.routes);

  return routes;
}
