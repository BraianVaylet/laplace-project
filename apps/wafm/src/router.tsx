import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { Home } from './Home.js';
import { MyQr } from './MyQr.js';
import { Shell } from './Shell.js';

/**
 * El router de la WAFM.
 *
 * "Mi QR" tiene que estar a **1 tap** desde cualquier pantalla (§2.1.18): es
 * una ruta de primer nivel en la bottom nav, no algo escondido en el perfil.
 */
const NAV_IDS: Record<string, string> = {
  '/': 'home',
  '/qr': 'qr',
};

const rootRoute = createRootRoute({
  component: function RootLayout() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });

    return (
      <Shell activeNavId={NAV_IDS[pathname] ?? 'home'}>
        <Outlet />
      </Shell>
    );
  },
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Home,
});

const qrRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/qr',
  component: MyQr,
});

export const routeTree = rootRoute.addChildren([homeRoute, qrRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
