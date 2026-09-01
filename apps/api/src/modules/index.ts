import { Hono } from 'hono';
import type { AppEnv } from '../app.js';
import type { EntitlementsLoader } from '../entitlements/middleware.js';
import type { DomainEventBus } from '../events/bus.js';
import { createVenuesModule } from './venues/index.js';

export interface ModuleDeps {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
}

/**
 * Punto de composicion del monolito modular. Cada modulo se arma acá y expone
 * sus rutas; nadie importa el modelo ni el repositorio de otro (ADR-003).
 *
 * Se devuelve un solo `Hono` con todas las rutas ya montadas para que `createApp`
 * no tenga que conocer los modulos uno por uno.
 */
export function createModuleRoutes(deps: ModuleDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  const venues = createVenuesModule(deps);
  routes.route('/', venues.routes);

  return routes;
}
