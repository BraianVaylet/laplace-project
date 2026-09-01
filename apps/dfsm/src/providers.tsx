import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react';
import { ThemeProvider, ToastProvider } from '@laplace/ui';
import { createQueryClient } from '@laplace/client';

/**
 * El cableado que comparten todas las pantallas del DFSM.
 *
 * El orden importa: `ToastProvider` va por fuera del cliente de API porque el
 * `onError` del cliente necesita poder mostrar un aviso, y `NuqsAdapter` por
 * fuera del router para que los filtros de §6 vivan en la URL.
 */
const queryClient = createQueryClient();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>{children}</NuqsAdapter>
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
