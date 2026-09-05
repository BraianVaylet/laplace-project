import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
  useRouterState,
} from '@tanstack/react-router';
import { ClassRoster } from './ClassRoster.js';
import { MemberFile } from './MemberFile.js';
import { Products } from './Products.js';
import { VenueDetail } from './VenueDetail.js';
import { Venues } from './Venues.js';
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

/**
 * La ficha 360 lleva el `memberId` **en la URL**: quien atiende la comparte por
 * WhatsApp con el dueño, la deja abierta y vuelve. Nada de eso funciona si la
 * pantalla vive en un estado de React.
 */
const memberRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/miembros/$memberId',
  component: function MemberRoute() {
    const { memberId } = useParams({ from: '/miembros/$memberId' });

    return <MemberFile memberId={memberId} />;
  },
});

const venuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sedes',
  component: Venues,
});

const venueDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sedes/$venueId',
  component: function VenueDetailRoute() {
    const { venueId } = useParams({ from: '/sedes/$venueId' });

    return <VenueDetail venueId={venueId} />;
  },
});

const productsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/productos',
  component: Products,
});

const kioskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kiosko',
  component: Kiosk,
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  rosterRoute,
  memberRoute,
  venuesRoute,
  venueDetailRoute,
  productsRoute,
  kioskRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
