import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, createRootRoute, RouterProvider } from '@tanstack/react-router';
import { createApiClient } from '@laplace/client';
import { Home } from './Home.js';

/**
 * El aviso de documentos pendientes en el home (§2.1.20): es lo que hace que
 * "los socios ven el texto al entrar a la WAFM" sea cierto y no algo escondido
 * en una pantalla a la que nadie entra.
 */
const respuesta = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

/** `Home` usa `<Link>` de TanStack Router: necesita un router real alrededor. */
function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  const rootRoute = createRootRoute({ component: () => <Home client={api} /> });
  const router = createRouter({ routeTree: rootRoute.addChildren([]) });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta([])));
});

describe('el aviso de documentos pendientes', () => {
  it('sin nada pendiente, no aparece', async () => {
    montar();

    expect(await screen.findByText('No tenés reservas')).toBeDefined();
    expect(screen.queryByText('Tenés documentos para firmar')).toBeNull();
  });

  it('con algo pendiente, avisa y ofrece ir a verlo', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta([
          { publicId: 'doc_1', accepted: false },
          { publicId: 'doc_2', accepted: true },
        ]),
      ),
    );
    montar();

    expect(await screen.findByText('Tenés documentos para firmar')).toBeDefined();
    // Solo cuenta el que falta firmar: el ya firmado no suma al aviso.
    expect(screen.getByText(/1 documento que todavía no firmaste/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Ver' })).toBeDefined();
  });
});
