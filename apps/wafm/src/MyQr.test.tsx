import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { MyQr } from './MyQr.js';

/**
 * "Mi QR" (§2.1.18): el código que abre la puerta. Lo que importa acá es que
 * aparezca solo, sin que el socio tenga que pedir nada, y que se renueve solo
 * mientras la pantalla sigue abierta — un QR vencido en la mano de alguien
 * parado en la puerta es peor que no tener QR.
 */
const TOKEN_1 = 'a'.repeat(32);
const TOKEN_2 = 'b'.repeat(32);

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
      <MyQr client={api} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      respuesta({ token: TOKEN_1, expiresAt: '2026-03-03T09:45:30Z', expiresInSeconds: 30 }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('el QR', () => {
  it('aparece solo: sin tocar nada, ya hay un código', async () => {
    montar();

    const contenedor = await screen.findByRole('img', { name: 'Código QR para tu check-in' });
    // El QR se arma con <rect> de React: si hay al menos uno, la matriz se
    // dibujó de verdad y no quedó un contenedor vacío.
    expect(contenedor.querySelector('svg rect')).not.toBeNull();
  });

  it('mientras carga, avisa que está cargando', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText('Generando tu QR')).toBeDefined();
  });

  it('sin ficha en el centro, dice qué hacer', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta(
          {
            success: false,
            error: {
              code: 'LP-MEMB-404-003',
              message: 'No encontramos tu ficha de socio en este centro.',
              action: 'Pedile al centro que te asocie con un código de invitación.',
              requestId: 'req-test',
              timestamp: '2026-03-03T09:45:00Z',
            },
          },
          404,
        ),
      ),
    );
    montar();

    expect(await screen.findByText('No pudimos generar tu QR')).toBeDefined();
    expect(
      screen.getByText('Pedile al centro que te asocie con un código de invitación.'),
    ).toBeDefined();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    expect(await screen.findByText('No pudimos generar tu QR')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });

  it('🔴 vencido el que tiene, pide uno nuevo solo — nadie toca "actualizar"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T09:45:00.000Z'));

    montar();
    // Deja que la promesa del primer POST se resuelva bajo el reloj falso.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Se renueva en 30s')).toBeDefined();

    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta({ token: TOKEN_2, expiresAt: '2026-03-03T09:46:00Z', expiresInSeconds: 30 }),
      ),
    );

    // Pasan los 30 segundos: el token vence y el efecto pide el siguiente sin
    // que nadie toque nada.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
