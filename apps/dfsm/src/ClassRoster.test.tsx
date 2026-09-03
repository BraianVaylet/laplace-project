import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { ClassRoster } from './ClassRoster.js';

/**
 * La lista de clase se usa **de pie, con una mano**, con el gimnasio lleno
 * (§5.1.2). Lo que se prueba acá es eso: que se pueda marcar de un toque, que
 * los estados de carga y error no dejen al coach mirando una pantalla en blanco
 * y que cada botón se pueda tocar con el pulgar.
 */
const LISTA = {
  sessionId: 'ses_1',
  name: 'Funcional',
  startAt: '2026-03-03T10:00:00Z',
  endAt: '2026-03-03T11:00:00Z',
  timeZone: 'America/Argentina/Buenos_Aires',
  capacity: 2,
  bookedCount: 2,
  presentCount: 1,
  waitlistCount: 1,
  checkInOpen: true,
  checkInOpensAt: '2026-03-03T09:30:00Z',
  checkInClosesAt: '2026-03-03T10:30:00Z',
  entries: [
    {
      bookingId: 'bkg_1',
      memberId: 'mem_1',
      fullName: 'Micaela Sosa',
      status: 'checked_in',
      waitlistPosition: null,
      checkedInAt: '2026-03-03T09:45:00Z',
      checkInMethod: 'staff',
      alerts: [],
    },
    {
      bookingId: 'bkg_2',
      memberId: 'mem_2',
      fullName: 'Joaquín Pérez',
      status: 'booked',
      waitlistPosition: null,
      checkedInAt: null,
      checkInMethod: null,
      alerts: ['debt'],
    },
    {
      bookingId: 'bkg_3',
      memberId: 'mem_3',
      fullName: 'Lucía Gómez',
      status: 'waitlisted',
      waitlistPosition: 1,
      checkedInAt: null,
      checkInMethod: null,
      alerts: [],
    },
  ],
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar(sessionId = 'ses_1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ClassRoster sessionId={sessionId} client={api} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta(LISTA)));
});

describe('la lista de clase', () => {
  it('muestra la clase, la hora del centro y cuántos entraron', async () => {
    montar();

    expect(await screen.findByRole('heading', { name: 'Funcional' })).toBeDefined();
    // 10:00 UTC son las 07:00 en Bahía Blanca: la hora que importa es la del box.
    expect(screen.getByText(/07:00 · 1 de 2 presentes/)).toBeDefined();
  });

  it('separa a los anotados de la lista de espera', async () => {
    montar();

    const inscriptos = await screen.findByRole('list', { name: 'Inscriptos' });
    expect(within(inscriptos).getAllByRole('listitem')).toHaveLength(2);

    const espera = screen.getByRole('list', { name: 'Lista de espera' });
    expect(within(espera).getByText('Lucía Gómez')).toBeDefined();
  });

  it('al que ya entró no le ofrece un botón: muestra que está presente', async () => {
    montar();

    const inscriptos = await screen.findByRole('list', { name: 'Inscriptos' });
    const [primero] = within(inscriptos).getAllByRole('listitem');

    expect(within(primero as HTMLElement).getByText('Presente')).toBeDefined();
    expect(within(primero as HTMLElement).queryByRole('button')).toBeNull();
  });

  it('marca presente de un toque', async () => {
    montar();
    const boton = await screen.findByRole('button', { name: 'Marcar' });

    await userEvent.click(boton);

    await waitFor(() => {
      const llamada = fetchMock.mock.calls.find(([url]) =>
        String(url).includes('/bookings/bkg_2/check-in'),
      );
      expect(llamada).toBeDefined();
    });
  });

  it('el check-in viaja con clave de idempotencia (§5.0)', async () => {
    montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Marcar' }));

    await waitFor(() => {
      const llamada = fetchMock.mock.calls.find(([url]) => String(url).includes('/check-in')) as
        [string, RequestInit] | undefined;
      const headers = llamada?.[1].headers as Record<string, string>;
      // El coach toca dos veces cuando la lista tarda: sin la clave, eso serían
      // dos ingresos.
      expect(headers['idempotency-key']).toBeTruthy();
    });
  });

  it('marca a todos de un toque', async () => {
    montar();

    await userEvent.click(await screen.findByRole('button', { name: 'Todos presentes' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/check-in-all'))).toBe(
        true,
      );
    });
  });

  it('muestra las alertas al lado del nombre', async () => {
    montar();

    expect(await screen.findByText('Debe')).toBeDefined();
  });

  it('con el check-in cerrado no deja marcar, y dice desde cuándo abre', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta({ ...LISTA, checkInOpen: false })),
    );
    montar();

    expect(await screen.findByText('Abre 06:30')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Todos presentes' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Marcar' }).hasAttribute('disabled')).toBe(true);
  });

  it('sin nadie anotado, el vacío explica qué va a pasar', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta({ ...LISTA, entries: [], bookedCount: 0, presentCount: 0 })),
    );
    montar();

    expect(await screen.findByText('Todavía no hay nadie anotado')).toBeDefined();
  });

  it('mientras carga avisa que está cargando', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText('Cargando la lista')).toBeDefined();
  });

  it('si falla, ofrece reintentar en vez de dejar la pantalla vacía', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta(
          {
            success: false,
            error: {
              code: 'LP-BOOK-404-006',
              message: 'No encontramos esa clase.',
              action: 'Volvé al horario y elegí otra.',
              requestId: 'req-test',
              timestamp: '2026-03-03T09:00:00Z',
            },
          },
          404,
        ),
      ),
    );
    montar();

    expect(await screen.findByText('No pudimos abrir la lista')).toBeDefined();
    expect(screen.getByText('Volvé al horario y elegí otra.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });

  it('los botones son alcanzables con el pulgar: 44 px de alto', async () => {
    montar();

    const marcar = await screen.findByRole('button', { name: 'Marcar' });
    const todos = screen.getByRole('button', { name: 'Todos presentes' });

    // `h-11` son 44 px y `h-12` son 48: el mínimo táctil de §5.1.2.
    expect(marcar.className).toContain('h-11');
    expect(todos.className).toContain('h-12');
  });
});
