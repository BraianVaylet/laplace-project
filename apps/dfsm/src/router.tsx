import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
} from '@tanstack/react-router';
import { ClassRoster } from './ClassRoster.js';
import { Home } from './Home.js';
import { Shell } from './Shell.js';

/**
 * El router del DFSM.
 *
 * Arranca con dos rutas: el tablero y la lista de clase. La lista lleva el
 * `sessionId` **en la URL** y no en un estado de React porque el coach abre la
 * clase desde el horario, la comparte con otro coach y vuelve a ella después de
 * cerrar la app; nada de eso funciona si la pantalla vive en memoria.
 */
const rootRoute = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
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

export const routeTree = rootRoute.addChildren([homeRoute, rosterRoute]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
