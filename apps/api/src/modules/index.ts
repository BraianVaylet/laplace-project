import { Hono } from 'hono';
import { createAuditWriter } from '../audit/audit-log.js';
import type { Temporal } from '@js-temporal/polyfill';
import type { Logger } from 'pino';
import type { AppEnv } from '../app.js';
import type { EntitlementsLoader } from '../entitlements/middleware.js';
import type { DomainEventBus } from '../events/bus.js';
import { createMembersModule, type OrganizationMembershipPort } from './members/index.js';
import { createContractsModule } from './contracts/index.js';
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
  /*
   * Products y Contracts se necesitan mutuamente: Contracts pregunta si se puede
   * vender, y Products pregunta si esa persona ya uso su clase de prueba. Se
   * resuelve con dos interfaces y un `lazy` de un lado, no importandose entre si
   * (ADR-003).
   */
  const products = createProductsModule({
    ...deps,
    purchases: { hasUsedTrial: (memberId) => contracts.service.hasUsedTrial(memberId) },
  });

  const contracts = createContractsModule({
    ...deps,
    audit: createAuditWriter(),
    products: {
      assertPurchasable: async (productId, memberId) => {
        const product = await products.service.assertPurchasable(productId, memberId);

        return {
          publicId: String(product['publicId']),
          name: product.name,
          type: product.type as never,
          priceCents: product.priceCents,
          currency: product.currency,
          credits: product.credits,
          durationDays: product.durationDays,
          weeklyLimit: product.weeklyLimit,
          monthlyLimit: product.monthlyLimit,
          allowedCategories: product.allowedCategories,
          allowedTimeRanges: product.allowedTimeRanges,
          autoRenew: product.autoRenew,
        };
      },
      registerSale: (productId) => products.service.registerSale(productId),
      releaseSale: (productId) => products.service.releaseSale(productId),
    },
    venues: { timeZoneOf: (venueId) => venues.service.timeZoneOf(venueId) },
  });

  routes.route('/', venues.routes);
  routes.route('/', rooms.routes);
  routes.route('/', members.routes);
  routes.route('/', products.routes);
  routes.route('/', contracts.routes);

  return routes;
}
