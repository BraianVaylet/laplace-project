import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { Health } from './Health.js';
import { Shell } from './Shell.js';
import { Subscribers } from './Subscribers.js';

/**
 * El DFSA (§5.1.1, §11.3). Lo que importa acá es que el super admin pueda
 * contestar dos preguntas — "¿cómo está el SaaS?" y "¿qué le pasó a este
 * usuario?" — y que **no** pueda ver datos de miembros por el camino.
 */
const SUSCRIPTORES = [
  {
    organizationId: 'org_1',
    centerName: 'Box Toro',
    status: 'active',
    planId: 'pro',
    priceSnapshotCents: 4_500_000,
    trialEndsAt: null,
    usage: { venues: 2, activeMembers: 120, staffUsers: 4 },
    limits: { venues: 3, activeMembers: 180, staffUsers: 10 },
    overLimit: false,
  },
  {
    organizationId: 'org_2',
    centerName: 'Pilates Sur',
    status: 'trial',
    planId: 'basic',
    priceSnapshotCents: 2_500_000,
    trialEndsAt: '2026-03-16T03:00:00Z',
    usage: { venues: 1, activeMembers: 61, staffUsers: 2 },
    limits: { venues: 1, activeMembers: 60, staffUsers: 3 },
    overLimit: true,
  },
];

const SALUD = {
  errorsByCode: [{ code: 'LP-BOOK-409-002', total: 12 }],
  failedJobs: [{ name: 'markNoShows', at: '2026-03-02T09:00:00Z', error: 'la base no respondió' }],
  pendingWebhooks: 0,
  subscribers: { total: 2, trial: 1, active: 1, suspended: 0 },
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const cliente = () =>
  createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

beforeEach(() => {
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(respuesta(String(url).includes('/health') ? SALUD : SUSCRIPTORES)),
  );
});

describe('shell del DFSA', () => {
  it('tiene la estructura de §5.1.1: header, panel lateral y footer', () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('estan los modulos del SAU', () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );

    for (const label of [
      'Suscriptores',
      'Planes',
      'Ejercicios',
      'Textos legales',
      'Salud del sistema',
    ]) {
      expect(screen.getByRole('link', { name: label }), label).toBeDefined();
    }
  });
});

describe('el listado de suscriptores', () => {
  it('muestra el uso contra el tope de cada plan', async () => {
    montar(<Subscribers client={cliente()} />);

    expect(await screen.findByText('Box Toro')).toBeDefined();
    expect(screen.getByText('120 de 180')).toBeDefined();
    expect(screen.getByText('61 de 60')).toBeDefined();
    // "2 de 3" sale dos veces: las sedes de uno y el staff del otro.
    expect(screen.getAllByText('2 de 3')).toHaveLength(2);
  });

  it('marca al que se pasó del tope: es la oportunidad de upsell', async () => {
    montar(<Subscribers client={cliente()} />);

    expect(await screen.findByText('Pasó el tope')).toBeDefined();
  });

  it('🔴 la pantalla dice que son conteos, no personas', async () => {
    // Es la garantía de ADR-004 decisión 7 puesta donde el SAU la lee.
    montar(<Subscribers client={cliente()} />);

    expect(await screen.findByText(/conteos, no personas/)).toBeDefined();
  });

  it('sin suscriptores, lo dice con su acción', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    montar(<Subscribers client={cliente()} />);

    expect(await screen.findByText('Todavía no hay suscriptores')).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar(<Subscribers client={cliente()} />);

    expect(await screen.findByText('No pudimos traer los suscriptores')).toBeDefined();
  });
});

describe('el panel de salud y el buscador de soporte (§11.3)', () => {
  it('muestra los errores por código y los jobs fallidos', async () => {
    montar(<Health client={cliente()} />);

    expect(await screen.findByText('LP-BOOK-409-002')).toBeDefined();
    expect(screen.getByText('markNoShows')).toBeDefined();
    expect(screen.getByText('la base no respondió')).toBeDefined();
  });

  it('🔴 un código con forma de código se busca como código', async () => {
    montar(<Health client={cliente()} />);
    await screen.findByText('LP-BOOK-409-002');

    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    await userEvent.type(screen.getByLabelText(/requestId/), 'LP-BOOK-409-002');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('errorCode=LP-BOOK-409-002')),
      ).toBe(true),
    );
  });

  it('cualquier otra cosa se busca como requestId', async () => {
    montar(<Health client={cliente()} />);
    await screen.findByText('LP-BOOK-409-002');

    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    await userEvent.type(screen.getByLabelText(/requestId/), 'abc-123-def');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes('requestId=abc-123-def')),
      ).toBe(true),
    );
  });

  it('sin resultados, lo dice y explica por qué puede pasar', async () => {
    montar(<Health client={cliente()} />);
    await screen.findByText('LP-BOOK-409-002');

    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    await userEvent.type(screen.getByLabelText(/requestId/), 'no-existe');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText(/más de 30 días/)).toBeDefined();
  });

  it('los webhooks pendientes se muestran aunque sean cero', async () => {
    montar(<Health client={cliente()} />);

    expect(await screen.findByText('Webhooks pendientes')).toBeDefined();
    expect(screen.getByText(/Fase 2/)).toBeDefined();
  });
});
