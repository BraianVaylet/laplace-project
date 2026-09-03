import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Notifications } from './Notifications.js';

/**
 * Los avisos del socio (§2.1.14). Lo que importa acá es que el opt-out se
 * encuentre y funcione, y que los avisos de plata se vean claramente como lo
 * que son: los únicos que no se pueden apagar.
 */
const AVISOS = {
  items: [
    {
      publicId: 'ntf_1',
      eventType: 'booking.created',
      channel: 'in_app',
      subject: 'Reservaste Funcional',
      body: 'Hola Micaela, reservaste Funcional para el lunes 9 de marzo a las 19:00.',
      status: 'sent',
      createdAt: '2026-03-02T12:00:00Z',
      sentAt: '2026-03-02T12:00:00Z',
      readAt: null,
    },
  ],
  nextCursor: null,
};

const PREFERENCIAS = [
  { eventType: 'booking.created', channel: 'email', enabled: true, critical: false },
  { eventType: 'charge.overdue', channel: 'email', enabled: true, critical: true },
];

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Notifications client={api} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const porDefecto = (url: string) =>
  String(url).includes('/notification-preferences')
    ? Promise.resolve(respuesta(PREFERENCIAS))
    : Promise.resolve(respuesta(AVISOS));

beforeEach(() => {
  fetchMock = vi.fn(porDefecto);
});

describe('la campana del socio', () => {
  it('muestra el aviso con su texto y lo marca como nuevo', async () => {
    montar();

    expect(await screen.findByRole('heading', { name: 'Reservaste Funcional' })).toBeDefined();
    expect(screen.getByText(/reservaste Funcional para el lunes 9/)).toBeDefined();
    expect(screen.getByText('Nuevo')).toBeDefined();
  });

  it('sin avisos, lo dice y explica qué va a llegar', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/notification-preferences')
        ? Promise.resolve(respuesta(PREFERENCIAS))
        : Promise.resolve(respuesta({ items: [], nextCursor: null })),
    );
    montar();

    expect(await screen.findByText('No tenés avisos')).toBeDefined();
  });

  it('marcarlo leído lo saca de "Nuevo"', async () => {
    montar();
    await screen.findByRole('button', { name: 'Marcar como leído' });

    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/notification-preferences')) {
        return Promise.resolve(respuesta(PREFERENCIAS));
      }
      if (String(url).includes('/read')) return Promise.resolve(respuesta({ read: true }));

      return Promise.resolve(
        respuesta({
          items: [{ ...AVISOS.items[0], readAt: '2026-03-02T13:00:00Z' }],
          nextCursor: null,
        }),
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Marcar como leído' }));

    await waitFor(() => expect(screen.queryByText('Nuevo')).toBeNull());
  });

  it('mientras carga, avisa que está cargando', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText('Cargando tus avisos')).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    expect(await screen.findByText('No pudimos traer tus avisos')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });
});

describe('el opt-out (§2.1.14)', () => {
  it('apagar un aviso manda el cambio', async () => {
    montar();
    const casilla = await screen.findByRole('checkbox', {
      name: /Confirmación de reserva · por mail/,
    });

    await userEvent.click(casilla);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/notification-preferences') &&
            (init as RequestInit | undefined)?.method === 'PUT',
        ),
      ).toBe(true),
    );
  });

  it('🔴 el aviso de plata se ve, pero no se puede apagar', async () => {
    montar();

    const critico = await screen.findByRole('checkbox', { name: /Pago pendiente · por mail/ });

    expect((critico as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Este aviso siempre se envía.')).toBeDefined();
  });
});
