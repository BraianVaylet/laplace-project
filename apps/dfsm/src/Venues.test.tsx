import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Venues } from './Venues.js';

/**
 * Sedes (F1-33). Es el primer paso del asistente y el que destraba todo: sin
 * sede no hay dónde poner una clase, un producto ni un socio.
 *
 * 🔴 Lo que importa acá es que el **límite del plan lo decide el servidor**. La
 * pantalla muestra lo que la API contesta, con su límite y su plan: adivinarlo
 * en el front sería una segunda fuente de verdad que un día dice otra cosa.
 */
const SEDE = {
  publicId: 'ven_1',
  name: 'Box Toro Centro',
  address: 'Alsina 123, Bahía Blanca',
  phone: '+542914567890',
  timeZone: 'America/Argentina/Buenos_Aires',
  currency: 'ARS',
  businessHours: [{ weekday: 1, opensAt: '06:00', closesAt: '22:00' }],
  bookingPolicy: {
    bookingOpensMinutesBefore: 10_080,
    bookingClosesMinutesBefore: 15,
    cancelCutoffMinutes: 120,
    checkInOpensMinutesBefore: 30,
    checkInClosesMinutesAfter: 30,
    allowDebt: false,
    lateCancelPolicy: 'no_refund',
  },
  status: 'active',
  createdAt: '2026-01-02T12:00:00Z',
  updatedAt: '2026-01-02T12:00:00Z',
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

const error = (code: string, message: string, status: number, action?: string) =>
  respuesta(
    {
      success: false,
      error: { code, message, ...(action ? { action } : {}), requestId: 'r', timestamp: 't' },
    },
    status,
  );

let fetchMock: ReturnType<typeof vi.fn>;

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Venues client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta({ items: [SEDE], nextCursor: null })));
});

describe('el listado', () => {
  it('muestra cada sede con su dirección y su zona', async () => {
    montar();

    expect(await screen.findByText('Box Toro Centro')).toBeDefined();
    expect(screen.getByText('Alsina 123, Bahía Blanca')).toBeDefined();
    expect(screen.getByText(/Buenos_Aires/)).toBeDefined();
  });

  it('🔴 la sede sin horarios lo dice: es lo que impide agendar', async () => {
    // Una sede sin horario deja publicar clases con todo cerrado. Decirlo acá
    // es más barato que descubrirlo cuando un socio se presenta a la puerta.
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta({ items: [{ ...SEDE, businessHours: [] }], nextCursor: null })),
    );
    montar();

    expect(await screen.findByText('Sin horarios cargados')).toBeDefined();
  });

  it('sin ninguna sede, ofrece crear la primera', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta({ items: [], nextCursor: null })));
    montar();

    expect(await screen.findByText('Todavía no tenés ninguna sede')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Crear la primera' })).toBeDefined();
  });

  it('mientras carga avisa, y sin red ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    expect(await screen.findByText('No pudimos traer tus sedes')).toBeDefined();
  });
});

describe('crear una sede', () => {
  it('pide lo mínimo y manda lo que se cargó', async () => {
    montar();
    await screen.findByText('Box Toro Centro');

    await userEvent.click(screen.getByRole('button', { name: 'Crear sede' }));
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Box Toro Norte');
    await userEvent.type(screen.getByLabelText(/Dirección/), 'Sarmiento 900, Bahía Blanca');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => {
      const alta = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(alta).toBeDefined();
      expect(JSON.parse(String((alta?.[1] as RequestInit).body))).toMatchObject({
        name: 'Box Toro Norte',
        address: 'Sarmiento 900, Bahía Blanca',
      });
    });
  });

  it('🔴 el tope del plan lo dice el servidor, con su número y su plan', async () => {
    /*
     * El front no adivina el límite: sería una segunda fuente de verdad que un
     * día dice otra cosa que el backend. Muestra el error tipado tal cual.
     */
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? error(
              'LP-ENTL-403-001',
              'Tu plan Basic permite 1 sede.',
              403,
              'Pasá a Pro para sumar más.',
            )
          : respuesta({ items: [SEDE], nextCursor: null }),
      ),
    );
    montar();
    await screen.findByText('Box Toro Centro');

    await userEvent.click(screen.getByRole('button', { name: 'Crear sede' }));
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Box Toro Norte');
    await userEvent.type(screen.getByLabelText(/Dirección/), 'Sarmiento 900, Bahía Blanca');
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByText('Tu plan Basic permite 1 sede.')).toBeDefined();
    expect(screen.getByText('Pasá a Pro para sumar más.')).toBeDefined();
  });
});
