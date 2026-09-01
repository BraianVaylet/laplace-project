import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UPDATE_ESCAPE_MS } from '@laplace/client';
import { InstallPrompt } from './InstallPrompt.js';
import { UpdateGate } from './UpdateGate.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';

function setUserAgent(value: string) {
  Object.defineProperty(globalThis.navigator, 'userAgent', { value, configurable: true });
}

/** jsdom no trae matchMedia; hace falta para detectar si ya corre instalada. */
function setStandalone(standalone: boolean) {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: standalone,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  globalThis.localStorage.clear();
  setStandalone(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ofrecimiento de instalar', () => {
  it('🔴 en iOS muestra las instrucciones, no un boton que no hace nada', async () => {
    setUserAgent(IPHONE);
    render(<InstallPrompt />);

    // `beforeinstallprompt` no existe en Safari: sin este camino, la mitad de
    // los socios ve un boton inerte.
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByText(/Compartir/)).toBeDefined();
    expect(screen.getByText(/Agregar a inicio/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Instalar' })).toBeNull();
  });

  it('en Chrome ofrece el boton nativo', async () => {
    setUserAgent(ANDROID);
    render(<InstallPrompt />);

    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = () => Promise.resolve();
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    globalThis.dispatchEvent(event);

    expect(await screen.findByRole('button', { name: 'Instalar' })).toBeDefined();
  });

  it('si ya esta instalada no ofrece nada', () => {
    setUserAgent(ANDROID);
    setStandalone(true);
    render(<InstallPrompt />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('en un navegador sin soporte no aparece', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0) Firefox/120.0');
    render(<InstallPrompt />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('🔴 rechazarlo lo silencia: no se muestra en cada visita', async () => {
    setUserAgent(IPHONE);
    const { unmount } = render(<InstallPrompt />);
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
    unmount();

    render(<InstallPrompt />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('popup de actualizacion', () => {
  it('no aparece si no hay version nueva', () => {
    render(<UpdateGate />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aparece cuando el service worker avisa', async () => {
    render(<UpdateGate />);

    globalThis.dispatchEvent(new Event('laplace:sw-update'));

    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Actualizar' })).toBeDefined();
  });

  it('🔴 mientras actualiza no se puede cerrar: es bloqueante, como pide la v1', async () => {
    render(<UpdateGate onActivate={() => undefined} />);
    globalThis.dispatchEvent(new Event('laplace:sw-update'));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Seguir sin actualizar' })).toBeNull();
  });

  it(`🔴 a los ${UPDATE_ESCAPE_MS / 1000}s habilita el escape: un SW roto no puede dejar encerrado al socio`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    render(<UpdateGate onActivate={() => undefined} />);
    globalThis.dispatchEvent(new Event('laplace:sw-update'));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));

    await vi.advanceTimersByTimeAsync(UPDATE_ESCAPE_MS + 1000);

    expect(await screen.findByRole('button', { name: 'Seguir sin actualizar' })).toBeDefined();
  });

  it('actualizar dispara la activacion del service worker', async () => {
    const onActivate = vi.fn();
    render(<UpdateGate onActivate={onActivate} />);
    globalThis.dispatchEvent(new Event('laplace:sw-update'));
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(onActivate).toHaveBeenCalledOnce();
  });
});
