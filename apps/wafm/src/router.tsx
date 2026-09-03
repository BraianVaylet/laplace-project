import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { Home } from './Home.js';
import { MyQr } from './MyQr.js';
import { Notifications } from './Notifications.js';
import { PendingWaivers } from './PendingWaivers.js';
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

/**
 * No es un ítem de la bottom nav: la spec fija las cinco de §5.1.3. Se llega
 * acá desde el aviso del home cuando hay algo pendiente por firmar.
 */
const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/documentos',
  component: PendingWaivers,
});

/**
 * Tampoco es un item de la bottom nav (§5.1.3 fija las cinco). Se llega desde
 * la campana del home: la spec pide una seccion de avisos en cada aplicativo
 * (§2.1.14), no un sexto tab.
 */
const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/avisos',
  component: Notifications,
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  qrRoute,
  documentsRoute,
  notificationsRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
