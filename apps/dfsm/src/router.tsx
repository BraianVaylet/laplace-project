import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
  useRouterState,
} from '@tanstack/react-router';
import { ClassRoster } from './ClassRoster.js';
import { Home } from './Home.js';
import { Kiosk } from './Kiosk.js';
import { Shell } from './Shell.js';

/**
 * El router del DFSM.
 *
 * La lista de clase lleva el `sessionId` **en la URL** y no en un estado de
 * React porque el coach abre la clase desde el horario, la comparte con otro
 * coach y vuelve a ella después de cerrar la app; nada de eso funciona si la
 * pantalla vive en memoria.
 *
 * **`/kiosko` no lleva el chrome del coach.** Es la pantalla que queda pegada
 * a una tablet en la pared de la entrada: mostrarle el panel lateral, las
 * métricas o cualquier otra cosa del centro sería exponerlas a quien pase por
 * la puerta.
 */
const rootRoute = createRootRoute({
  component: function RootLayout() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    if (pathname.startsWith('/kiosko')) return <Outlet />;

    return (
      <Shell>
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

const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/clases/$sessionId',
  component: function RosterRoute() {
    const { sessionId } = useParams({ from: '/clases/$sessionId' });

    return <ClassRoster sessionId={sessionId} />;
  },
});

const kioskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kiosko',
  component: Kiosk,
});

export const routeTree = rootRoute.addChildren([homeRoute, rosterRoute, kioskRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
