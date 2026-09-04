import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import type { OnboardingProgress, OnboardingStep } from '@laplace/schemas';
import { Onboarding } from './Onboarding.js';

/**
 * El asistente de primeros pasos (§2.1.3). La métrica de §2.0 es
 * **time-to-first-class < 30 min**: es donde se pierde el SaaS.
 *
 * 🔴 Lo que no se negocia: que **saltear un paso no lo muestre como hecho**.
 * Una barra que llega al 100% con el centro vacío es peor que no tener barra.
 */
const paso = (over: Partial<OnboardingStep> = {}): OnboardingStep => ({
  id: 'venue',
  title: 'Creá tu sede',
  description: 'El lugar donde entrenan.',
  href: '/sedes',
  required: true,
  done: false,
  skipped: false,
  blocked: false,
  ...over,
});

const PROGRESO: OnboardingProgress = {
  steps: [
    paso({ id: 'venue', title: 'Creá tu sede', done: true }),
    paso({ id: 'hours', title: 'Cargá los horarios', required: false }),
    paso({ id: 'class', title: 'Publicá tu primera clase', href: '/horario' }),
    paso({ id: 'product', title: 'Creá algo para vender', href: '/productos' }),
    paso({ id: 'invite', title: 'Invitá a tus socios', required: false, href: '/members' }),
  ],
  currentStep: 'hours',
  doneCount: 1,
  totalCount: 5,
  percent: 20,
  completedAt: null,
  timeToFirstClassMinutes: null,
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar(progreso: OnboardingProgress = PROGRESO) {
  fetchMock.mockImplementation(() => Promise.resolve(respuesta(progreso)));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Onboarding client={client} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta(PROGRESO)));
});

describe('la barra de progreso', () => {
  it('dice cuánto falta, con el valor accesible', async () => {
    montar();

    const barra = await screen.findByRole('progressbar');
    expect(barra.getAttribute('aria-valuenow')).toBe('20');
    expect(screen.getByText('1 de 5 pasos')).toBeDefined();
  });

  it('🔴 el paso hecho se distingue del pendiente sin depender del color', async () => {
    // El contraste no alcanza: quien no distingue verde de gris necesita el
    // texto (DoD §15).
    montar();

    expect(await screen.findByText('Listo')).toBeDefined();
  });
});

describe('🔴 saltear no es completar', () => {
  it('el paso salteado se muestra pendiente, no hecho', async () => {
    montar({
      ...PROGRESO,
      steps: PROGRESO.steps.map((s) => (s.id === 'invite' ? { ...s, skipped: true } : s)),
    });

    expect(await screen.findByText('Lo dejaste para después')).toBeDefined();
    // "Listo" sigue apareciendo una sola vez: la de la sede, que sí está hecha.
    expect(screen.getAllByText('Listo')).toHaveLength(1);
  });

  it('el salteado se puede retomar', async () => {
    montar({
      ...PROGRESO,
      steps: PROGRESO.steps.map((s) => (s.id === 'invite' ? { ...s, skipped: true } : s)),
    });
    await screen.findByText('Lo dejaste para después');

    await userEvent.click(screen.getByRole('button', { name: 'Retomar Invitá a tus socios' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/invite/resume'))).toBe(
        true,
      ),
    );
  });

  it('saltear pega en la ruta del paso, no en otra', async () => {
    montar();
    await screen.findByRole('progressbar');

    await userEvent.click(
      screen.getByRole('button', { name: 'Dejar para después Cargá los horarios' }),
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/hours/skip'))).toBe(true),
    );
  });
});

describe('🔴 el paso que todavía no se puede hacer', () => {
  it('se explica en vez de dejar tocar y fallar', async () => {
    montar({
      ...PROGRESO,
      steps: PROGRESO.steps.map((s) =>
        s.id === 'venue' ? { ...s, done: false } : { ...s, blocked: true },
      ),
      currentStep: 'venue',
      doneCount: 0,
      percent: 0,
    });

    // Los cuatro que dependen de la sede lo dicen; el de la sede no.
    expect(await screen.findAllByText('Primero necesitás una sede')).toHaveLength(4);
    expect(screen.getAllByText('Trabado')).toHaveLength(4);
  });
});

describe('cuando ya está', () => {
  it('🔴 el asistente terminado no ocupa la pantalla', async () => {
    // Terminado el onboarding, el home vuelve a ser el tablero del día: dejar
    // el checklist arriba para siempre le roba el lugar a lo que importa.
    const { container } = montar({
      ...PROGRESO,
      steps: PROGRESO.steps.map((s) => ({ ...s, done: true })),
      currentStep: null,
      doneCount: 5,
      percent: 100,
      completedAt: '2026-03-02T21:22:00Z',
    });

    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('mientras carga no parpadea con un checklist vacío', () => {
    const { container } = montar();

    expect(container.textContent).toBe('');
  });
});

describe('los bordes', () => {
  it('si el progreso no se puede traer, el home sigue funcionando', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = createApiClient({
      baseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <Onboarding client={client} />
      </QueryClientProvider>,
    );

    // Un asistente roto no puede tapar el tablero: se calla y ya.
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
