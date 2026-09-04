import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { MyPacks } from './MyPacks.js';

/**
 * Mis packs (§2.1.2). Contesta las dos preguntas que el socio hoy manda por
 * WhatsApp: cuántas clases le quedan y hasta cuándo.
 */
const PACK = {
  contractId: 'ctr_1',
  productName: 'Pack 8 clases',
  productType: 'class_pack',
  status: 'active',
  creditsLeft: 3,
  creditsTotal: 8,
  endsAt: '2026-03-15T03:00:00Z',
  daysLeft: 13,
  expiringSoon: false,
  allowedCategories: [],
  venueId: 'ven_1',
};

const respuesta = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MyPacks client={client} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta([PACK])));
});

describe('mis packs', () => {
  it('🔴 dice cuántas clases quedan y cuándo vence', async () => {
    montar();

    expect(await screen.findByText('Te quedan 3 de 8 clases.')).toBeDefined();
    expect(screen.getByText('Vence en 13 días.')).toBeDefined();
  });

  it('el singular no queda mal escrito: "te queda 1 clase"', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta([{ ...PACK, creditsLeft: 1, daysLeft: 1 }])),
    );
    montar();

    expect(await screen.findByText('Te queda 1 de 8 clase.')).toBeDefined();
    expect(screen.getByText('Vence en 1 día.')).toBeDefined();
  });

  it('🔴 el pack por vencer ofrece renovar; el que no, no', async () => {
    // El CTA aparece cuando renovar cambia algo. Antes es ruido.
    montar();
    await screen.findByText('Te quedan 3 de 8 clases.');
    expect(screen.queryByRole('button', { name: 'Renovar en el centro' })).toBeNull();

    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta([{ ...PACK, expiringSoon: true, daysLeft: 3 }])),
    );
    montar();

    expect(await screen.findByRole('button', { name: 'Renovar en el centro' })).toBeDefined();
  });

  it('🔴 el pack sin clases se muestra igual: es la explicación de por qué no puede reservar', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta([{ ...PACK, creditsLeft: 0, status: 'exhausted' }])),
    );
    montar();

    expect(await screen.findByText('No te quedan clases.')).toBeDefined();
    expect(screen.getByText('Sin clases')).toBeDefined();
  });

  it('la membresía no cuenta clases', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta([
          { ...PACK, creditsLeft: null, creditsTotal: null, productType: 'membership_unlimited' },
        ]),
      ),
    );
    montar();

    expect(await screen.findByText('Membresía: entrás las veces que quieras.')).toBeDefined();
  });

  it('el vencido lo dice sin vueltas', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(respuesta([{ ...PACK, daysLeft: -3, status: 'expired' }])),
    );
    montar();

    expect(await screen.findByText('Ya venció.')).toBeDefined();
  });

  it('sin packs, explica qué va a ver acá', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    montar();

    expect(await screen.findByText('Todavía no tenés ningún pack')).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    expect(await screen.findByText('No pudimos traer tus packs')).toBeDefined();
  });
});
