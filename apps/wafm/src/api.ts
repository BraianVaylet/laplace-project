import { createApiClient } from '@laplace/client';

/**
 * Cliente de la API para esta app. Vive aparte de `providers.tsx` porque no es
 * un componente: mezclarlos rompe Fast Refresh y, mas importante, mezcla dos
 * responsabilidades.
 */
export const api = createApiClient({
  baseUrl: import.meta.env['VITE_API_BASE_URL'] ?? 'http://localhost:3000/api/v1',
});
