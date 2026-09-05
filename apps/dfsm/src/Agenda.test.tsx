import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient, useUiStore } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Agenda } from './Agenda.js';

/**
 * La agenda del centro (§2.1.5.a, F1-35). Es donde el SMU pasa el tiempo cuando
 * arma la semana.
 *
 * 🔴 Dos cosas no se negocian. Que editar una clase **pregunte el alcance** —
 * cambiar "todas las de los lunes" cuando se quería cambiar una sola reescribe
 * la grilla de un mes — y que cancelar **diga a cuánta gente afecta antes de
 * confirmar**: del otro lado hay socios que se organizaron para venir.
 */
const SEDES = {
  items: [
    { publicId: 'ven_1', name: 'Box Toro Centro', timeZone: 'America/Argentina/Buenos_Aires' },
  ],
};

const SALAS = { items: [{ publicId: 'rom_1', venueId: 'ven_1', name: 'Principal', capacity: 20 }] };

const CLASE = {
  publicId: 'ses_1',
  venueId: 'ven_1',
  roomId: 'rom_1',
  templateId: 'tpl_1',
  name: 'Funcional',
  categoryId: 'funcional',
  startAt: '2026-03-04T22:00:00Z',
  endAt: '2026-03-04T23:00:00Z',
  capacity: 16,
  bookedCount: 14,
  waitlistCount: 2,
  status: 'scheduled',
  createdAt: '2026-02-01T12:00:00Z',
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let clases = [CLASE];

const porDefecto = (url: string) => {
  if (url.includes('/venues')) return respuesta(SEDES);
  if (url.includes('/rooms')) return respuesta(SALAS);
  if (url.includes('/sessions')) return respuesta(clases);

  return respuesta({});
};

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
        <Agenda client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const llamada = (metodo: string) =>
  fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === metodo);

beforeEach(() => {
  vi.setSystemTime(new Date('2026-03-02T12:00:00Z'));
  useUiStore.setState({ activeVenueId: 'ven_1' });
  clases = [CLASE];
  fetchMock = vi.fn((url: string) => Promise.resolve(porDefecto(String(url))));
});

describe('la grilla', () => {
  it('muestra la clase con su hora, su cupo y su sala', async () => {
    montar();

    expect(await screen.findByText('Funcional')).toBeDefined();
    expect(screen.getByText('14 de 16')).toBeDefined();
    expect(screen.getByText('Principal')).toBeDefined();
  });

  it('la clase con lista de espera lo dice: es la señal de que falta cupo', async () => {
    montar();

    expect(await screen.findByText('2 en espera')).toBeDefined();
  });

  it('sin clases en la semana, ofrece publicar la primera', async () => {
    clases = [];
    montar();

    expect(await screen.findByText('No hay clases esta semana')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Publicar una clase' })).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/sessions')
        ? Promise.reject(new Error('sin red'))
        : Promise.resolve(porDefecto(String(url))),
    );
    montar();

    expect(await screen.findByText('No pudimos traer la agenda')).toBeDefined();
  });
});

describe('🔴 editar una clase pregunta el alcance (§2.1.5.a)', () => {
  it('ofrece las dos opciones, y solo esta viene elegida', async () => {
    // Propagar por default reescribiría clases ya publicadas sin que nadie lo
    // pidiera. El que quiere cambiar todas, lo dice.
    montar();
    await screen.findByText('Funcional');

    await userEvent.click(screen.getByRole('button', { name: 'Editar Funcional' }));

    const soloEsta = screen.getByLabelText(/Solo esta clase/) as HTMLInputElement;
    expect(soloEsta.checked).toBe(true);
    expect(screen.getByLabelText(/Esta y las que siguen/)).toBeDefined();
  });

  it('"solo esta" edita la sesión', async () => {
    montar();
    await screen.findByText('Funcional');

    await userEvent.click(screen.getByRole('button', { name: 'Editar Funcional' }));
    await userEvent.clear(screen.getByLabelText(/Cupo/));
    await userEvent.type(screen.getByLabelText(/Cupo/), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      const patch = llamada('PATCH');
      expect(String(patch?.[0])).toContain('/sessions/ses_1');
      expect(String(patch?.[0])).not.toContain('scope=');
    });
  });

  it('🔴 "esta y las que siguen" edita la plantilla, con su alcance en la URL', async () => {
    montar();
    await screen.findByText('Funcional');

    await userEvent.click(screen.getByRole('button', { name: 'Editar Funcional' }));
    await userEvent.click(screen.getByLabelText(/Esta y las que siguen/));
    await userEvent.clear(screen.getByLabelText(/Cupo/));
    await userEvent.type(screen.getByLabelText(/Cupo/), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => {
      const patch = llamada('PATCH');
      expect(String(patch?.[0])).toContain('/class-templates/tpl_1?scope=this_and_future');
    });
  });

  it('la clase suelta no ofrece propagar: no tiene a qué', async () => {
    clases = [{ ...CLASE, templateId: undefined as unknown as string }];
    montar();
    await screen.findByText('Funcional');

    await userEvent.click(screen.getByRole('button', { name: 'Editar Funcional' }));

    expect(screen.queryByLabelText(/Esta y las que siguen/)).toBeNull();
  });
});

describe('🔴 cancelar dice a cuánta gente afecta', () => {
  it('muestra los inscriptos y que se les devuelve el crédito, antes de confirmar', async () => {
    // Del otro lado hay 14 personas que se organizaron para venir.
    montar();
    await screen.findByText('Funcional');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar Funcional' }));

    expect(await screen.findByText(/14 reservas/)).toBeDefined();
    expect(screen.getByText(/se les devuelve el crédito/i)).toBeDefined();
  });

  it('🔴 exige un motivo: al socio le llega en el aviso', async () => {
    montar();
    await screen.findByText('Funcional');

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar Funcional' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la clase' }));

    // Sin motivo no sale el pedido: el socio recibe "se canceló" y nada más.
    expect(llamada('POST')).toBeUndefined();

    await userEvent.type(screen.getByLabelText(/Motivo/), 'Se rompió el aire acondicionado');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar la clase' }));

    await waitFor(() => {
      const post = llamada('POST');
      expect(String(post?.[0])).toContain('/sessions/ses_1/cancel');
      expect(JSON.parse(String((post?.[1] as RequestInit).body)).reason).toBe(
        'Se rompió el aire acondicionado',
      );
    });
  });
});

describe('🔴 la clase que ya pasó', () => {
  it('no se puede editar ni cancelar: es el histórico', async () => {
    // Reescribir lo que ya ocurrió deja un registro que no coincide con lo que
    // pasó de verdad.
    clases = [{ ...CLASE, startAt: '2026-03-01T22:00:00Z', endAt: '2026-03-01T23:00:00Z' }];
    montar();
    await screen.findByText('Funcional');

    expect(screen.queryByRole('button', { name: 'Editar Funcional' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancelar Funcional' })).toBeNull();
  });
});

describe('publicar una clase', () => {
  it('crea la plantilla con sus días y su hora', async () => {
    clases = [];
    montar();
    await screen.findByText('No hay clases esta semana');

    await userEvent.click(screen.getByRole('button', { name: 'Publicar una clase' }));
    await userEvent.type(screen.getByLabelText(/Nombre de la clase/), 'Funcional');
    await userEvent.type(screen.getByLabelText(/Categoría/), 'funcional');
    await userEvent.click(screen.getByLabelText('Lunes'));
    await userEvent.click(screen.getByLabelText('Miércoles'));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));

    await waitFor(() => {
      const post = llamada('POST');
      expect(String(post?.[0])).toContain('/class-templates');
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
        name: 'Funcional',
        categoryId: 'funcional',
        recurrence: { byWeekday: [1, 3] },
      });
    });
  });
});
