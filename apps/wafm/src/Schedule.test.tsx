import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import { createApiClient, IDEMPOTENCY_KEY_HEADER, useUiStore } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Schedule } from './Schedule.js';

/**
 * El horario y la reserva (§2.1.5, §5.1.3). Es la pantalla que el socio abre
 * todos los días, muchas veces en el colectivo.
 *
 * Lo que se verifica y no se negocia: que la reserva **responda al instante y
 * se revierta** si la API dice que no, y que la **política de cancelación se
 * vea antes de confirmar** — descubrirla después de perder el crédito es la
 * queja número uno de este tipo de producto.
 */
const MANANA = Temporal.Now.instant().add({ hours: 24 });

const CLASE = {
  publicId: 'ses_1',
  venueId: 'ven_1',
  roomId: 'rom_1',
  name: 'Funcional',
  categoryId: 'funcional',
  startAt: MANANA.toString(),
  endAt: MANANA.add({ hours: 1 }).toString(),
  capacity: 16,
  bookedCount: 14,
  waitlistCount: 0,
  status: 'scheduled',
  createdAt: MANANA.toString(),
};

const POLITICA = {
  sessionId: 'ses_1',
  opensAt: MANANA.subtract({ hours: 48 }).toString(),
  closesAt: MANANA.toString(),
  cancelCutoffAt: MANANA.subtract({ hours: 2 }).toString(),
  lateCancelPolicy: 'no_refund',
  text: 'Podés cancelar hasta 2 horas antes sin perder el crédito.',
  canBookNow: true,
};

const SEDES = { items: [{ publicId: 'ven_1', name: 'Box Toro Centro' }] };

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

/** El envelope de error de §5.0, que es lo que la pantalla tiene que leer. */
const error = (code: string, message: string, status = 409) =>
  respuesta(
    { success: false, error: { code, message, requestId: 'req-test', timestamp: '2026-03-02' } },
    status,
  );

let fetchMock: ReturnType<typeof vi.fn>;

/** El estado por defecto: una clase con lugar y ninguna reserva propia. */
const porDefecto = (url: string) => {
  const ruta = String(url);
  if (ruta.includes('/venues')) return Promise.resolve(respuesta(SEDES));
  if (ruta.includes('/booking-policies')) return Promise.resolve(respuesta(POLITICA));
  if (ruta.includes('/bookings'))
    return Promise.resolve(respuesta({ items: [], nextCursor: null }));

  return Promise.resolve(respuesta([CLASE]));
};

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Schedule client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useUiStore.setState({ activeVenueId: 'ven_1' });
  fetchMock = vi.fn(porDefecto);
});

describe('el horario', () => {
  it('muestra la clase con su cupo disponible', async () => {
    montar();

    expect(await screen.findByText(/Funcional/)).toBeDefined();
    expect(screen.getByText('2 lugares')).toBeDefined();
    expect(screen.getByText('14 de 16')).toBeDefined();
  });

  it('sin clases publicadas, lo dice', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/sessions') ? Promise.resolve(respuesta([])) : porDefecto(url),
    );
    montar();

    expect(await screen.findByText('No hay clases publicadas')).toBeDefined();
  });

  it('mientras carga, avisa que está cargando', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText('Cargando el horario')).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/sessions') ? Promise.reject(new Error('sin red')) : porDefecto(url),
    );
    montar();

    expect(await screen.findByText('No pudimos traer el horario')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });

  it('el selector de sede no aparece con una sola: sería ruido', async () => {
    montar();
    await screen.findByText(/Funcional/);

    expect(screen.queryByLabelText('Centro')).toBeNull();
  });

  it('con más de una sede, se puede elegir', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/venues')
        ? Promise.resolve(
            respuesta({
              items: [
                { publicId: 'ven_1', name: 'Box Toro Centro' },
                { publicId: 'ven_2', name: 'Box Toro Norte' },
              ],
            }),
          )
        : porDefecto(url),
    );
    montar();

    expect(await screen.findByLabelText('Centro')).toBeDefined();
  });
});

describe('reservar', () => {
  const abrirConfirmacion = async () => {
    montar();
    await screen.findByText(/Funcional/);
    await userEvent.click(screen.getByRole('button', { name: 'Reservar' }));
  };

  it('🔴 muestra la política de cancelación ANTES de confirmar (§2.1.5.d)', async () => {
    await abrirConfirmacion();

    expect(
      await screen.findByText('Podés cancelar hasta 2 horas antes sin perder el crédito.'),
    ).toBeDefined();
  });

  it('🔴 el cupo baja al instante, antes de que conteste la API', async () => {
    let resolver: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            resolver = resolve;
          })
        : porDefecto(url),
    );

    await abrirConfirmacion();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar reserva' }));

    // Sin esperar la respuesta: 14 de 16 pasó a 15 de 16.
    await waitFor(() => expect(screen.getByText('15 de 16')).toBeDefined());
    resolver(respuesta({ booking: { ...CLASE, status: 'booked', publicId: 'bkg_1' } }, 201));
  });

  it('🔴 si la API dice que no, revierte y muestra el mensaje del error tipado', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(error('LP-BOOK-409-002', 'La clase ya está completa.'))
        : porDefecto(url),
    );

    await abrirConfirmacion();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar reserva' }));

    // El mensaje es el de la API, no uno inventado por el front.
    expect(await screen.findByText('La clase ya está completa.')).toBeDefined();
    // Y el cupo volvió a donde estaba.
    await waitFor(() => expect(screen.getByText('14 de 16')).toBeDefined());
  });

  it('la reserva lleva clave de idempotencia: tocar dos veces no gasta dos créditos', async () => {
    await abrirConfirmacion();
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar reserva' }));

    await waitFor(() => {
      const reserva = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      const headers = (reserva?.[1] as RequestInit | undefined)?.headers as Record<string, string>;

      expect(headers[IDEMPOTENCY_KEY_HEADER]).toBeDefined();
    });
  });
});

describe('la clase completa', () => {
  const COMPLETA = { ...CLASE, bookedCount: 16, waitlistCount: 3 };

  const conClaseCompleta = (url: string) =>
    String(url).includes('/sessions') && !String(url).includes('booking-policies')
      ? Promise.resolve(respuesta([COMPLETA]))
      : porDefecto(url);

  it('🔴 ofrece la lista de espera en vez de un botón muerto', async () => {
    fetchMock.mockImplementation(conClaseCompleta);
    montar();

    expect(await screen.findByRole('button', { name: 'Anotarme en la espera' })).toBeDefined();
    expect(screen.getByText('Completa')).toBeDefined();
    expect(screen.getByText(/3 en espera/)).toBeDefined();
  });

  it('el modal explica cómo sigue la fila', async () => {
    fetchMock.mockImplementation(conClaseCompleta);
    montar();
    await screen.findByRole('button', { name: 'Anotarme en la espera' });

    await userEvent.click(screen.getByRole('button', { name: 'Anotarme en la espera' }));

    expect(await screen.findByText(/Si alguien cancela, te avisamos/)).toBeDefined();
  });
});

describe('cancelar', () => {
  const RESERVA = {
    publicId: 'bkg_1',
    sessionId: 'ses_1',
    memberId: 'mem_1',
    venueId: 'ven_1',
    status: 'booked',
    waitlistPosition: null,
    bookedAt: MANANA.toString(),
    createdAt: MANANA.toString(),
  };

  const conReserva = (url: string) =>
    String(url).includes('/bookings') && !String(url).includes('booking-policies')
      ? Promise.resolve(respuesta({ items: [RESERVA], nextCursor: null }))
      : porDefecto(url);

  it('la clase reservada se ve como reservada y ofrece cancelar', async () => {
    fetchMock.mockImplementation(conReserva);
    montar();

    expect(await screen.findByText('Reservado')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDefined();
  });

  it('🔴 dice si recupera el crédito ANTES de confirmar', async () => {
    fetchMock.mockImplementation(conReserva);
    montar();
    await screen.findByText('Reservado');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    // Está en plazo: la clase es mañana y el corte es 2 horas antes.
    expect(await screen.findByText(/recuperás el crédito/)).toBeDefined();
  });

  it('avisa cuando está fuera de plazo, con lo que eso implica', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/booking-policies')
        ? Promise.resolve(
            respuesta({
              ...POLITICA,
              // El corte ya pasó.
              cancelCutoffAt: Temporal.Now.instant().subtract({ hours: 1 }).toString(),
            }),
          )
        : conReserva(url),
    );
    montar();
    await screen.findByText('Reservado');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByText(/podés perder el crédito/)).toBeDefined();
  });
});
