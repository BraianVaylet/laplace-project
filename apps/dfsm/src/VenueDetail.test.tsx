import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { VenueDetail } from './VenueDetail.js';

/**
 * La configuración de una sede (F1-33): sus horarios, su política de reserva y
 * sus salas.
 *
 * 🔴 Lo que se prueba: que **cada regla diga qué pasa si no se toca**. Una
 * política de reserva son siete números; sin el default explicado al lado, el
 * SMU los deja como están sin saber qué eligió.
 */
const SEDE = {
  publicId: 'ven_1',
  name: 'Box Toro Centro',
  address: 'Alsina 123, Bahía Blanca',
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

const SALAS = {
  items: [
    {
      publicId: 'rom_1',
      venueId: 'ven_1',
      name: 'Principal',
      capacity: 20,
      equipment: [],
      status: 'active',
      createdAt: '2026-01-02T12:00:00Z',
      updatedAt: '2026-01-02T12:00:00Z',
    },
  ],
  nextCursor: null,
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

const porDefecto = (url: string) => (url.includes('/rooms') ? respuesta(SALAS) : respuesta(SEDE));

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
        <VenueDetail venueId="ven_1" client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const cuerpoDe = (metodo: string) => {
  const llamada = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === metodo,
  );

  return llamada ? JSON.parse(String((llamada[1] as RequestInit).body)) : undefined;
};

beforeEach(() => {
  fetchMock = vi.fn((url: string) => Promise.resolve(porDefecto(String(url))));
});

describe('los horarios', () => {
  it('trae los siete días, con el que ya está cargado marcado', async () => {
    montar();

    expect(await screen.findByLabelText('Abre el lunes')).toBeDefined();
    expect(screen.getByLabelText('Abre el domingo')).toBeDefined();
    expect((screen.getByLabelText('Abre el lunes') as HTMLInputElement).value).toBe('06:00');
  });

  it('🔴 guardar manda solo los días que abren', async () => {
    // Un día con horario en blanco no es "abre a las 00:00": es que no abre.
    montar();
    await screen.findByLabelText('Abre el lunes');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));

    await waitFor(() => {
      expect(cuerpoDe('PATCH')).toMatchObject({
        businessHours: [{ weekday: 1, opensAt: '06:00', closesAt: '22:00' }],
      });
    });
  });

  it('cargar un día nuevo lo suma', async () => {
    montar();
    await screen.findByLabelText('Abre el lunes');

    await userEvent.type(screen.getByLabelText('Abre el sábado'), '09:00');
    await userEvent.type(screen.getByLabelText('Cierra el sábado'), '13:00');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horarios' }));

    await waitFor(() => {
      expect(cuerpoDe('PATCH').businessHours).toContainEqual({
        weekday: 6,
        opensAt: '09:00',
        closesAt: '13:00',
      });
    });
  });
});

describe('🔴 la política de reserva', () => {
  it('cada regla dice qué pasa si no se toca', async () => {
    // Son siete números. Sin el default explicado al lado, el SMU los deja
    // como están sin saber qué eligió.
    montar();

    expect(await screen.findByText(/Por defecto: 2 horas antes/)).toBeDefined();
    expect(screen.getByText(/Por defecto: 30 minutos antes/)).toBeDefined();
  });

  it('🔴 dice qué pasa con el crédito de quien cancela tarde', async () => {
    // Es la regla que más se reclama: enterarse después de haber perdido el
    // crédito es lo que la hace sentir arbitraria.
    montar();

    expect(await screen.findByLabelText('Si cancela tarde')).toBeDefined();
  });

  it('guardar manda los minutos, que es lo que la API entiende', async () => {
    montar();
    await screen.findByLabelText('Si cancela tarde');

    await userEvent.selectOptions(screen.getByLabelText('Hasta cuándo se puede cancelar'), '240');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar política' }));

    await waitFor(() => {
      expect(cuerpoDe('PATCH').bookingPolicy).toMatchObject({ cancelCutoffMinutes: 240 });
    });
  });

  it('permitir reservar debiendo está apagado y se dice por qué', async () => {
    montar();

    // El label del checkbox incluye su descripción: por eso el match es parcial.
    const flag = await screen.findByLabelText(/Dejar reservar a quien debe/);
    expect((flag as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/quien debe no toma un lugar hasta ponerse al día/)).toBeDefined();
  });
});

describe('archivar la sede', () => {
  it('🔴 pide confirmar y aclara que el histórico queda', async () => {
    // Archivar no es borrar: las clases que ya ocurrieron son el registro de lo
    // que pasó, y el cupo del plan se libera igual.
    montar();
    await screen.findByLabelText('Abre el lunes');

    await userEvent.click(screen.getByRole('button', { name: 'Archivar la sede' }));

    expect(await screen.findByText('Archivar Box Toro Centro')).toBeDefined();
    // Lo dice el aviso de la tarjeta y de nuevo el del diálogo, antes de confirmar.
    expect(screen.getAllByText(/lo que ya ocurrió queda/i)).toHaveLength(2);
    expect(screen.getByText(/primero hay que cancelarlas/i)).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).endsWith('/venues/ven_1/archive')),
      ).toBe(true),
    );
  });
});

describe('las salas', () => {
  it('lista las que hay con su capacidad', async () => {
    montar();

    expect(await screen.findByText('Principal')).toBeDefined();
    expect(screen.getByText('20 personas')).toBeDefined();
  });

  it('crear una sala manda su sede', async () => {
    montar();
    await screen.findByText('Principal');

    await userEvent.click(screen.getByRole('button', { name: 'Agregar sala' }));
    await userEvent.type(screen.getByLabelText(/Nombre de la sala/), 'Sala de fuerza');
    await userEvent.clear(screen.getByLabelText(/Capacidad/));
    await userEvent.type(screen.getByLabelText(/Capacidad/), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => {
      expect(cuerpoDe('POST')).toMatchObject({
        venueId: 'ven_1',
        name: 'Sala de fuerza',
        capacity: 12,
      });
    });
  });
});
