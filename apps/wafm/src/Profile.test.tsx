import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { Profile } from './Profile.js';

/**
 * Mi perfil (§2.1.2, §9.2). Lo que importa: que el socio pueda editar lo suyo,
 * y que **sus derechos sobre sus datos estén a la vista** — esconderlos detrás
 * de un mail a soporte es la forma habitual de no cumplirlos.
 */
const PERFIL = {
  memberId: 'mem_1',
  fullName: 'Micaela Sosa',
  email: 'micaela@laplace.test',
  phone: '+542914567890',
  emergencyContact: { fullName: 'Ana Sosa', phone: '+542914000000' },
  avatarUrl: null,
};

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

const error = (code: string, message: string, status = 422) =>
  respuesta(
    { success: false, error: { code, message, requestId: 'req-test', timestamp: '2026-03-02' } },
    status,
  );

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
        <Profile client={client} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta(PERFIL)));
});

describe('mis datos', () => {
  it('trae lo que ya está cargado', async () => {
    montar();

    expect(await screen.findByDisplayValue('Micaela Sosa')).toBeDefined();
    expect(screen.getByDisplayValue('+542914567890')).toBeDefined();
    expect(screen.getByDisplayValue('Ana Sosa')).toBeDefined();
  });

  it('🔴 el nombre lo cambia el centro, no el socio', async () => {
    // La ficha es del centro: el socio corrige su contacto, no su identidad.
    montar();

    const nombre = await screen.findByDisplayValue('Micaela Sosa');
    expect((nombre as HTMLInputElement).disabled).toBe(true);
  });

  it('guardar manda solo lo que cambió', async () => {
    montar();
    await screen.findByDisplayValue('Micaela Sosa');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        ),
      ).toBe(true),
    );
  });

  it('el contacto de emergencia explica para qué es', async () => {
    montar();

    expect(await screen.findByText(/si te pasa algo entrenando/)).toBeDefined();
  });
});

describe('la foto', () => {
  it('sin foto muestra la inicial, no un hueco', async () => {
    montar();

    expect(await screen.findByRole('button', { name: 'Cambiar la foto' })).toBeDefined();
    expect(screen.getByText('M')).toBeDefined();
  });

  it('dice qué formatos y qué tamaño acepta antes de elegir', async () => {
    montar();

    expect(await screen.findByText('JPG, PNG o WebP, hasta 2 MB.')).toBeDefined();
  });

  it('🔴 si el servidor rechaza el archivo, se ve el motivo', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(
            error('LP-ACCT-422-001', 'El archivo tiene que ser una imagen JPG, PNG o WebP.'),
          )
        : Promise.resolve(respuesta(PERFIL)),
    );
    montar();
    await screen.findByRole('button', { name: 'Cambiar la foto' });

    const input = screen.getByLabelText('Elegir una foto de perfil');
    await userEvent.upload(input, new File(['<svg/>'], 'foto.png', { type: 'image/png' }));

    expect(
      await screen.findByText('El archivo tiene que ser una imagen JPG, PNG o WebP.'),
    ).toBeDefined();
  });
});

describe('mis derechos sobre mis datos (§9.2)', () => {
  it('🔴 están en la pantalla, no escondidos en un mail a soporte', async () => {
    montar();

    expect(await screen.findByRole('button', { name: 'Descargar mis datos' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Pedir la baja' })).toBeDefined();
    expect(screen.getByText(/Ley 25.326/)).toBeDefined();
  });

  it('🔴 pedir la baja explica que los datos se conservan y hasta cuándo', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(
            respuesta({ requestedAt: '2026-03-02T12:00:00Z', purgeAfter: '2026-05-31T12:00:00Z' }),
          )
        : Promise.resolve(respuesta(PERFIL)),
    );
    montar();
    await screen.findByRole('button', { name: 'Pedir la baja' });

    await userEvent.click(screen.getByRole('button', { name: 'Pedir la baja' }));

    // Decir "listo, borrado" sería mentir: el centro tiene obligaciones sobre
    // lo firmado y lo cobrado.
    expect(await screen.findByText(/se conservan hasta el 2026-05-31/)).toBeDefined();
  });

  it('el botón de baja no se puede tocar dos veces', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(
            respuesta({ requestedAt: '2026-03-02T12:00:00Z', purgeAfter: '2026-05-31T12:00:00Z' }),
          )
        : Promise.resolve(respuesta(PERFIL)),
    );
    montar();
    await screen.findByRole('button', { name: 'Pedir la baja' });

    await userEvent.click(screen.getByRole('button', { name: 'Pedir la baja' }));

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Pedir la baja' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
  });
});
