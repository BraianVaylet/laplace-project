import { RouterProvider } from '@tanstack/react-router';
import { router } from './router.js';

/**
 * El DFSA. El shell y las pantallas viven en sus propios archivos: acá solo se
 * monta el router, que es lo que hace que "suscriptores" y "salud" sean dos
 * URLs y no dos estados de React — el SAU comparte el link de una búsqueda de
 * soporte con otro, y eso no funciona si la pantalla vive en memoria.
 */
export function App() {
  return <RouterProvider router={router} />;
}
