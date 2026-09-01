import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError, NetworkError } from '../api/client.js';

/**
 * Defaults de Tanstack Query pensados para este producto.
 *
 * El caso que manda: un socio abre la app en el sotano del gimnasio, sin señal.
 * Tiene que ver el horario cacheado en vez de una pantalla vacia (§5.1.3).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Un horario de clases no cambia cada segundo; 30s evita el parpadeo de
        // refetch al cambiar de pestaña sin mostrar datos viejos de verdad.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          /*
           * No se reintenta lo que no va a mejorar por insistir: un 409 "clase
           * completa" o un 403 "sin permisos" van a fallar igual la segunda vez,
           * y reintentar solo hace esperar al usuario para el mismo error.
           */
          if (error instanceof ApiRequestError) {
            const retriable = error.status >= 500 || error.status === 429;
            return retriable && failureCount < 2;
          }

          // Un corte de red si vale la pena reintentarlo.
          if (error instanceof NetworkError) return failureCount < 3;

          return false;
        },
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Una mutacion reintentada sola puede duplicar una reserva o un cobro.
        // El reintento es decision de quien la llama, con su Idempotency-Key.
        retry: false,
      },
    },
  });
}
