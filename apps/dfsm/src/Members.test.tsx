import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Members } from './Members.js';

/**
 * El padrón del centro (§2.1.7, F1-36) y los códigos de invitación (§2.1.4).
 *
 * 🔴 Lo que no se negocia: que **la columna de saldo no exista** para quien no
 * puede ver plata. La API ya manda `null` desde F1-06; la pantalla no puede
 * inventar un "$0" que además sería mentira.
 */
const SOCIO = {
  publicId: 'mem_1',
  venueIds: ['ven_1'],
  firstName: 'Micaela',
  lastName: 'Sosa',
  phone: '+542914567890',
  status: 'active',
  flags: { debtor: false, suspended: false },
  tags: ['mañana'],
  balanceCents: -1_200_000,
  joinedAt: '2025-11-02T12:00:00Z',
  lastAttendanceAt: '2026-02-21T22:00:00Z',
  noShowCount: 0,
  bookingBlockedUntil: null,
  createdAt: '2025-11-02T12:00:00Z',
  updatedAt: '2026-02-21T22:00:00Z',
};

const CODIGO = {
  publicId: 'inv_1',
  code: 'TORO-2026',
  venueId: 'ven_1',
  maxUses: 50,
  usedCount: 12,
  expiresAt: '2026-03-31T00:00:00Z',
  revokedAt: null,
  status: 'active',
  createdAt: '2026-01-02T12:00:00Z',
};

const SEDES = { items: [{ publicId: 'ven_1', name: 'Box Toro Centro' }] };

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let socios: unknown[] = [SOCIO];
let codigos: unknown[] = [CODIGO];

const porDefecto = (url: string) => {
  if (url.includes('/venues')) return respuesta(SEDES);
  if (url.includes('/invite-codes')) return respuesta({ items: codigos, nextCursor: null });

  return respuesta({ items: socios, nextCursor: null });
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
        <Members client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const llamada = (metodo: string) =>
  fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === metodo);

beforeEach(() => {
  socios = [SOCIO];
  codigos = [CODIGO];
  fetchMock = vi.fn((url: string) => Promise.resolve(porDefecto(String(url))));
});

describe('el padrón', () => {
  it('lista a cada socio y lleva a su ficha', async () => {
    montar();

    const enlace = await screen.findByRole('link', { name: /Micaela Sosa/ });
    expect(enlace.getAttribute('href')).toBe('/miembros/mem_1');
  });

  it('filtrar por estado va en el pedido, no en el navegador', async () => {
    // Filtrar en el cliente sobre una página funciona hasta el socio 51.
    montar();
    await screen.findByRole('link', { name: /Micaela Sosa/ });

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'active');

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=active'))).toBe(
        true,
      ),
    );
  });

  it('sin socios, ofrece el camino corto: el código de invitación', async () => {
    socios = [];
    montar();

    expect(await screen.findByText('Todavía no tenés socios')).toBeDefined();
  });
});

describe('🔴 la plata en el listado (§2.1.12)', () => {
  it('con saldo, se ve la deuda', async () => {
    montar();

    expect(await screen.findByText(/12\.000/)).toBeDefined();
  });

  it('🔴 si la API manda el saldo en null, no hay columna de saldo', async () => {
    // Es lo que le pasa al coach desde F1-06. Pintar "$0" sería inventar un
    // dato que además está mal.
    socios = [{ ...SOCIO, balanceCents: null }];
    montar();

    await screen.findByRole('link', { name: /Micaela Sosa/ });
    expect(screen.queryByText('Saldo')).toBeNull();
  });
});

describe('dar de alta un socio', () => {
  it('manda los datos con su sede', async () => {
    montar();
    await screen.findByRole('link', { name: /Micaela Sosa/ });

    await userEvent.click(screen.getByRole('button', { name: 'Agregar socio' }));
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Julián');
    await userEvent.type(screen.getByLabelText(/Apellido/), 'Pérez');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    await waitFor(() => {
      const post = llamada('POST');
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
        firstName: 'Julián',
        lastName: 'Pérez',
        venueIds: ['ven_1'],
      });
    });
  });

  it('🔴 el error del servidor se muestra tal cual: el tutor del menor lo decide la API', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? respuesta(
              {
                success: false,
                error: {
                  code: 'LP-MEMB-422-004',
                  message: 'Cargá el tutor responsable antes de continuar.',
                  requestId: 'r',
                  timestamp: 't',
                },
              },
              422,
            )
          : porDefecto(String(url)),
      ),
    );
    montar();
    await screen.findByRole('link', { name: /Micaela Sosa/ });

    await userEvent.click(screen.getByRole('button', { name: 'Agregar socio' }));
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Juan');
    await userEvent.type(screen.getByLabelText(/Apellido/), 'Pérez');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText('Cargá el tutor responsable antes de continuar.')).toBeDefined();
  });
});

describe('los códigos de invitación', () => {
  it('muestra el código, sus usos y hasta cuándo vale', async () => {
    montar();

    expect(await screen.findByText('TORO-2026')).toBeDefined();
    expect(screen.getByText('12 de 50 usos')).toBeDefined();
  });

  it('🔴 revocar avisa que no afecta a quienes ya lo usaron', async () => {
    // Es la duda que frena a cualquiera antes de tocar el botón.
    montar();
    await screen.findByText('TORO-2026');

    await userEvent.click(screen.getByRole('button', { name: 'Revocar TORO-2026' }));

    expect(await screen.findByText(/quienes ya lo usaron siguen siendo socios/i)).toBeDefined();
  });

  it('generar uno pide vencimiento y límite de usos', async () => {
    codigos = [];
    montar();
    await screen.findByText('Todavía no generaste ningún código');

    await userEvent.click(screen.getByRole('button', { name: 'Generar el primero' }));

    expect(screen.getByLabelText(/Cuántas personas/)).toBeDefined();
    expect(screen.getByLabelText(/Vence el/)).toBeDefined();
  });
});
