import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';

/**
 * La app de la WAFM. El shell y los providers viven en el árbol de rutas, así
 * que acá solo queda el router: cada pantalla nueva se agrega en `router.tsx`
 * sin tocar este archivo.
 */
export function App() {
  return <RouterProvider router={router} />;
}
