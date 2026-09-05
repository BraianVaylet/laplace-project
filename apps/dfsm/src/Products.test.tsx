import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Products } from './Products.js';

/**
 * El catálogo (§2.1.17, F1-34). Sin producto no hay contrato, y sin contrato
 * nadie puede reservar.
 *
 * 🔴 Dos cosas se prueban acá. Que **el formulario muestre solo los campos del
 * tipo elegido** —un "ilimitado" no lleva créditos, y ofrecer el campo invita a
 * cargar una contradicción que después el motor de reservas tiene que
 * desambiguar— y que **el dinero nunca se vuelva float**.
 */
const PACK = {
  publicId: 'prd_1',
  name: 'Pack 8 clases',
  type: 'class_pack',
  priceCents: 6_000_000,
  currency: 'ARS',
  credits: 8,
  durationDays: 30,
  allowedCategories: [],
  allowedTimeRanges: [],
  venueIds: ['ven_1'],
  visibleInApp: true,
  autoRenew: false,
  soldCount: 4,
  active: true,
  createdAt: '2026-01-02T12:00:00Z',
  updatedAt: '2026-01-02T12:00:00Z',
};

const SEDES = { items: [{ publicId: 'ven_1', name: 'Box Toro Centro' }], nextCursor: null };

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

const porDefecto = (url: string) =>
  url.includes('/venues') ? respuesta(SEDES) : respuesta({ items: [PACK], nextCursor: null });

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
        <Products client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const cuerpoPost = () => {
  const llamada = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
  );

  return llamada ? JSON.parse(String((llamada[1] as RequestInit).body)) : undefined;
};

async function abrirAlta(tipo: string) {
  await userEvent.click(screen.getByRole('button', { name: 'Crear producto' }));
  await userEvent.selectOptions(screen.getByLabelText(/Tipo/), tipo);
}

beforeEach(() => {
  fetchMock = vi.fn((url: string) => Promise.resolve(porDefecto(String(url))));
});

describe('el catálogo', () => {
  it('muestra cada producto con su precio y lo que trae', async () => {
    montar();

    expect(await screen.findByText('Pack 8 clases')).toBeDefined();
    expect(screen.getByText(/60\.000/)).toBeDefined();
    expect(screen.getByText('8 clases · vence en 30 días')).toBeDefined();
  });

  it('sin productos, ofrece crear el primero', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/venues')
          ? respuesta(SEDES)
          : respuesta({ items: [], nextCursor: null }),
      ),
    );
    montar();

    expect(await screen.findByText('Todavía no tenés nada para vender')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Crear el primero' })).toBeDefined();
  });
});

describe('🔴 el formulario sigue al tipo', () => {
  it('un pack pide clases y vencimiento', async () => {
    montar();
    await screen.findByText('Pack 8 clases');

    await abrirAlta('class_pack');

    expect(screen.getByLabelText(/Cuántas clases trae/)).toBeDefined();
    expect(screen.getByLabelText(/En cuántos días vence/)).toBeDefined();
  });

  it('🔴 una membresía ilimitada no ofrece créditos', async () => {
    // Ofrecer el campo invita a cargar una contradicción que después el motor
    // de reservas tiene que desambiguar.
    montar();
    await screen.findByText('Pack 8 clases');

    await abrirAlta('membership_unlimited');

    expect(screen.queryByLabelText(/Cuántas clases trae/)).toBeNull();
    expect(screen.getByLabelText(/Período de la membresía/)).toBeDefined();
  });

  it('la membresía limitada pide su tope', async () => {
    montar();
    await screen.findByText('Pack 8 clases');

    await abrirAlta('membership_limited');

    expect(screen.getByLabelText(/Tope semanal/)).toBeDefined();
    expect(screen.getByLabelText(/Tope mensual/)).toBeDefined();
  });

  it('🔴 la clase de prueba es gratis y no se puede cobrar', async () => {
    // §2.1.17: cobrarla la convierte en una clase suelta con otro nombre.
    montar();
    await screen.findByText('Pack 8 clases');

    await abrirAlta('trial');

    const precio = screen.getByLabelText(/Precio/) as HTMLInputElement;
    expect(precio.value).toBe('0');
    expect(precio.disabled).toBe(true);
    expect(screen.getByText(/La clase de prueba es gratuita/)).toBeDefined();
  });
});

describe('🔴 el dinero', () => {
  it('se carga en pesos y viaja en centavos enteros', async () => {
    montar();
    await screen.findByText('Pack 8 clases');

    await abrirAlta('class_pack');
    await userEvent.type(screen.getByLabelText(/Nombre/), 'Pack 12 clases');
    await userEvent.clear(screen.getByLabelText(/Precio/));
    await userEvent.type(screen.getByLabelText(/Precio/), '75000.50');
    await userEvent.clear(screen.getByLabelText(/Cuántas clases trae/));
    await userEvent.type(screen.getByLabelText(/Cuántas clases trae/), '12');
    await userEvent.clear(screen.getByLabelText(/En cuántos días vence/));
    await userEvent.type(screen.getByLabelText(/En cuántos días vence/), '45');
    // Con una sola sede viene tildada: elegir entre una opción no es elegir.
    expect((screen.getByLabelText(/Box Toro Centro/) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Crear' }));

    await waitFor(() => {
      // 75.000,50 pesos son 7500050 centavos, nunca 7500050.0000001.
      expect(cuerpoPost()).toMatchObject({
        name: 'Pack 12 clases',
        priceCents: 7_500_050,
        credits: 12,
        durationDays: 45,
        venueIds: ['ven_1'],
      });
      expect(Number.isInteger(cuerpoPost().priceCents)).toBe(true);
    });
  });
});

describe('archivar', () => {
  it('🔴 aclara que los contratos vivos siguen funcionando', async () => {
    // Archivar saca el producto de la venta; quien ya lo compró sigue
    // entrenando con lo que pagó.
    montar();
    await screen.findByText('Pack 8 clases');

    await userEvent.click(screen.getByRole('button', { name: 'Archivar Pack 8 clases' }));

    expect(await screen.findByText(/quienes ya lo compraron siguen/i)).toBeDefined();
  });

  it('el producto con ventas dice cuántas lleva', async () => {
    montar();

    expect(await screen.findByText('4 vendidos')).toBeDefined();
  });
});
