import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { ToastProvider } from '@laplace/ui';
import { PendingWaivers } from './PendingWaivers.js';

/**
 * Los documentos que el socio tiene que firmar (§2.1.20). Es riesgo legal, no
 * una funcionalidad opcional: lo que importa acá es que nadie firme algo que
 * no pudo leer, y que firmar sea posible desde el teléfono.
 */
const DOCUMENTOS = [
  {
    publicId: 'doc_1',
    type: 'liability_waiver',
    title: 'Deslinde de responsabilidad',
    contentHtml: '<p>Entreno bajo mi <strong>propia responsabilidad</strong>.</p>',
    contentHash: 'a'.repeat(64),
    version: 1,
    required: true,
    publishedAt: '2026-03-01T00:00:00Z',
    accepted: false,
  },
];

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
      <ToastProvider>
        <PendingWaivers client={api} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta(DOCUMENTOS)));
});

describe('los documentos pendientes', () => {
  it('sin nada pendiente, dice que está al día', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    montar();

    expect(await screen.findByText('No tenés nada pendiente')).toBeDefined();
  });

  it('muestra el título y que está pendiente', async () => {
    montar();

    expect(
      await screen.findByRole('heading', { name: 'Deslinde de responsabilidad' }),
    ).toBeDefined();
    expect(screen.getByText('Pendiente')).toBeDefined();
  });

  it('el texto no se ve hasta tocar "leer el texto completo"', async () => {
    montar();
    await screen.findByRole('heading', { name: 'Deslinde de responsabilidad' });

    expect(screen.queryByText(/propia responsabilidad/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Leer el texto completo' }));

    expect(screen.getByText(/propia responsabilidad/)).toBeDefined();
  });

  it('🔴 saca un `<script>` del texto antes de mostrarlo', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        respuesta([
          {
            ...DOCUMENTOS[0],
            contentHtml: '<p>Hola</p><script>window.robado = document.cookie</script>',
          },
        ]),
      ),
    );
    montar();
    await screen.findByRole('heading', { name: 'Deslinde de responsabilidad' });
    await userEvent.click(screen.getByRole('button', { name: 'Leer el texto completo' }));

    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('Hola')).toBeDefined();
  });

  it('firmar manda el pedido y refresca el estado a "Firmado"', async () => {
    montar();
    await screen.findByRole('button', { name: 'Acepto' });

    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/accept')
        ? Promise.resolve(respuesta({ accepted: true }))
        : Promise.resolve(respuesta([{ ...DOCUMENTOS[0], accepted: true }])),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Acepto' }));

    await waitFor(() => expect(screen.getByText('Firmado')).toBeDefined());
    expect(screen.queryByRole('button', { name: 'Acepto' })).toBeNull();
  });

  it('sin conexión, ofrece reintentar', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();

    expect(await screen.findByText('No pudimos traer tus documentos')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
  });

  it('mientras carga, avisa que está cargando', () => {
    fetchMock.mockImplementation(() => new Promise(() => undefined));
    montar();

    expect(screen.getByLabelText('Cargando tus documentos')).toBeDefined();
  });
});
