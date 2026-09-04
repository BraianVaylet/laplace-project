import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createApiClient, useUiStore } from '@laplace/client';
import { Home } from './Home.js';

/**
 * El tablero operativo del día (§5.1.2). Lo que importa acá es que el SMU
 * abra el DFSM y vea **lo que hay que hacer hoy**, no un menú — y que lo que
 * el coach no puede ver simplemente no esté.
 */
const TABLERO = {
  venueId: 'ven_1',
  date: '2026-03-04',
  sessions: [
    {
      sessionId: 'ses_1',
      name: 'Funcional',
      startAt: '2026-03-04T22:00:00Z',
      startsAtLocal: '19:00',
      capacity: 16,
      booked: 3,
      checkedIn: 1,
      occupancy: 0.1875,
      status: 'scheduled',
    },
  ],
  checkedIn: 1,
  booked: 3,
  money: { incomeCents: 34_000_000, overdueCents: 1_800_000, debtors: 2 },
  alerts: [
    {
      type: 'inactive_members',
      count: 7,
      items: [
        { id: 'mem_1', label: 'Micaela Sosa', detail: 'Última vez el 2026-02-01' },
        { id: 'mem_2', label: 'Julián Pérez', detail: 'Nunca asistió' },
      ],
    },
    { type: 'debtors', count: 0, items: [] },
  ],
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
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
  useUiStore.setState({ activeVenueId: 'ven_1' });
  fetchMock = vi.fn(() => Promise.resolve(respuesta(TABLERO)));
});

describe('las clases de hoy', () => {
  it('salen con su hora, su ocupación y quién entró', async () => {
    montar();

    expect(await screen.findByText('Funcional')).toBeDefined();
    expect(screen.getByText('19:00')).toBeDefined();
    expect(screen.getByText('3 de 16')).toBeDefined();
    expect(screen.getByText('1 adentro')).toBeDefined();
  });

  it('sin clases, ofrece crear la primera', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta({ ...TABLERO, sessions: [], alerts: [] })),
    );
    montar();

    expect(await screen.findByText('Todavía no tenés clases')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Crear la primera' })).toBeDefined();
  });
});

describe('el panel de alertas (§2.1.12)', () => {
  it('🔴 muestra los ítems, no solo el número', async () => {
    // Una alerta que no se puede tocar es un dato, y los datos ya están en las
    // métricas.
    montar();

    expect(await screen.findByText('Micaela Sosa')).toBeDefined();
    expect(screen.getByText('Última vez el 2026-02-01')).toBeDefined();
  });

  it('el total dice la verdad aunque la lista esté recortada', async () => {
    montar();

    expect(await screen.findByText('7')).toBeDefined();
    expect(screen.getByText('y 5 más.')).toBeDefined();
  });

  it('la alerta vacía no ocupa lugar', async () => {
    montar();
    await screen.findByText('Micaela Sosa');

    expect(screen.queryByText('Deudores')).toBeNull();
  });

  it('sin ninguna alerta, lo dice y no deja el hueco', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta({ ...TABLERO, alerts: [{ type: 'debtors', count: 0, items: [] }] }),
      ),
    );
    montar();

    expect(await screen.findByText('Sin alertas')).toBeDefined();
  });
});

describe('la plata', () => {
  it('el SMU ve lo cobrado y la deuda, con su aviso', async () => {
    montar();

    expect(await screen.findByText('$340.000')).toBeDefined();
    expect(screen.getByText('$18.000')).toBeDefined();
    expect(screen.getByText('Hay deuda')).toBeDefined();
  });

  it('🔴 sin `money`, los cobros no aparecen: es el tablero del coach', async () => {
    // El backend no manda el bloque; la pantalla no lo inventa en cero.
    const { money: _money, ...sinPlata } = TABLERO;
    fetchMock.mockImplementation(() => Promise.resolve(respuesta(sinPlata)));
    montar();

    expect(await screen.findByText('Funcional')).toBeDefined();
    expect(screen.queryByText('Cobrado hoy')).toBeNull();
    expect(screen.queryByText('Deuda vencida')).toBeNull();
  });
});

describe('los estados de la pantalla', () => {
  it('mientras carga, avisa que está cargando', async () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(await screen.findByLabelText('Cargando el tablero')).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    expect(await screen.findByText('No pudimos abrir el tablero')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });

  it('sin centro activo, pide elegir uno y no pega a la API', async () => {
    useUiStore.setState({ activeVenueId: null });
    montar();

    expect(await screen.findByText('Elegí un centro')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
