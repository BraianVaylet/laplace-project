import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createApiClient } from '@laplace/client';
import { Kiosk } from './Kiosk.js';

/**
 * El tablet-kiosko de la puerta (§2.1.18). El WiFi del gimnasio es el peor
 * lugar para depender de la conexión: la tablet está lejos del router, y
 * cuando se corta hay gente esperando para entrar. Lo que se prueba acá es
 * justamente eso — que un corte no pierda el escaneo y que se sincronice solo
 * al volver la red, sin que nadie tenga que tocar nada.
 */
const CHECK_IN_OK = {
  bookingId: 'bkg_1',
  sessionId: 'ses_1',
  memberId: 'mem_1',
  status: 'checked_in',
  checkedInAt: '2026-03-03T09:45:00Z',
  checkInMethod: 'self',
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar() {
  const api = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(<Kiosk client={api} />);
}

beforeEach(() => {
  // La cola vive en localStorage con una clave fija: sin esto, un test
  // arrastraría los escaneos del anterior.
  localStorage.clear();
  fetchMock = vi.fn(() => Promise.resolve(respuesta(CHECK_IN_OK)));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('el kiosko de la puerta', () => {
  it('el foco queda en el input: el lector necesita poder "escribir" ahí', () => {
    montar();

    expect(document.activeElement?.id).toBe('kiosk-token');
  });

  it('escanea un código y lo registra', async () => {
    montar();

    await userEvent.type(screen.getByLabelText('Código escaneado'), 'un-token-cualquiera{Enter}');

    expect(await screen.findByText('Check-in registrado.')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('el input se limpia después de cada escaneo, listo para el siguiente', async () => {
    montar();
    const input = screen.getByLabelText('Código escaneado') as HTMLInputElement;

    await userEvent.type(input, 'token-1{Enter}');

    await waitFor(() => expect(input.value).toBe(''));
  });

  it('🔴 sin red, encola el escaneo y no lo pierde', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    await userEvent.type(screen.getByLabelText('Código escaneado'), 'token-offline{Enter}');

    expect(
      await screen.findByText('Sin conexión: se va a registrar apenas vuelva el WiFi.'),
    ).toBeDefined();
    expect(screen.getByText('1 escaneo esperando para sincronizar.')).toBeDefined();
  });

  it('sobrevive a que se recargue la tablet: el escaneo sigue en la cola', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    const primera = montar();
    await userEvent.type(screen.getByLabelText('Código escaneado'), 'token-persistente{Enter}');
    await screen.findByText('1 escaneo esperando para sincronizar.');
    primera.unmount();

    // Otra instancia, como después de un refresh de la tablet.
    fetchMock.mockClear();
    montar();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('vuelve la red y sincroniza solo, sin que nadie toque nada', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();
    await userEvent.type(screen.getByLabelText('Código escaneado'), 'token-reconexion{Enter}');
    await screen.findByText('1 escaneo esperando para sincronizar.');

    fetchMock.mockImplementation(() => Promise.resolve(respuesta(CHECK_IN_OK)));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByText('1 escaneo esperando para sincronizar.')).toBeNull();
    });
  });

  it('un código que el backend rechaza no se reintenta para siempre', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta(
          {
            success: false,
            error: {
              code: 'LP-ATTD-422-004',
              message: 'El código venció. Abrí de nuevo tu QR.',
              requestId: 'req-test',
              timestamp: '2026-03-03T09:45:00Z',
            },
          },
          422,
        ),
      ),
    );
    montar();

    await userEvent.type(screen.getByLabelText('Código escaneado'), 'token-vencido{Enter}');

    expect(
      await screen.findByText(
        'Un código no se pudo registrar: pedile a la persona que muestre uno nuevo.',
      ),
    ).toBeDefined();
    // No quedó "esperando": reintentarlo mil veces no lo iba a arreglar.
    expect(screen.queryByText(/esperando para sincronizar/)).toBeNull();
  });

  it('muestra si está conectado o no', async () => {
    montar();
    expect(screen.getByText('Conectado')).toBeDefined();

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText('Sin conexión')).toBeDefined();
  });
});
