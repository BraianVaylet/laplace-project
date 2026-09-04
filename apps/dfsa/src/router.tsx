import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { Health } from './Health.js';
import { Shell } from './Shell.js';
import { Subscribers } from './Subscribers.js';

/**
 * El router del DFSA.
 *
 * Solo las tres pantallas que la Fase 1 necesita (§5.1.1): suscriptores,
 * planes y salud. Ejercicios globales y textos legales están en la navegación
 * porque el SAU los va a necesitar, pero llegan con sus propias tarjetas.
 */
const NAV_IDS: Record<string, string> = {
  '/': 'subscribers',
  '/suscriptores': 'subscribers',
  '/salud': 'health',
};

const rootRoute = createRootRoute({
  component: function RootLayout() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });

    return (
      <Shell activeNavId={NAV_IDS[pathname] ?? 'subscribers'}>
        <Outlet />
      </Shell>
    );
  },
});

const subscribersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Subscribers,
});

const subscribersAliasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suscriptores',
  component: Subscribers,
});

const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/salud',
  component: Health,
});

export const routeTree = rootRoute.addChildren([
  subscribersRoute,
  subscribersAliasRoute,
  healthRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
