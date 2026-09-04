import type { RouteRecord } from 'vite-react-ssg';
import { Layout } from './Layout.js';
import { Home } from './pages/Home.js';
import { Terms } from './pages/Terms.js';
import { Privacy } from './pages/Privacy.js';
import { DataProcessing } from './pages/DataProcessing.js';

/**
 * Rutas que se prerenderizan a HTML estatico (ADR-005).
 *
 * Cada una sale del build como un archivo servible: un buscador lee el
 * contenido sin ejecutar JavaScript, que es la unica forma de que la landing
 * rankee (§5.1.4).
 */
export const routes: RouteRecord[] = [
  {
    path: '/',
    element: <Layout />,
    entry: 'src/Layout.tsx',
    children: [
      { index: true, Component: Home, entry: 'src/pages/Home.tsx' },
      { path: 'terminos', Component: Terms, entry: 'src/pages/Terms.tsx' },
      { path: 'privacidad', Component: Privacy, entry: 'src/pages/Privacy.tsx' },
      {
        path: 'tratamiento-de-datos',
        Component: DataProcessing,
        entry: 'src/pages/DataProcessing.tsx',
      },
    ],
  },
];
