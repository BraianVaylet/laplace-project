import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { MemberSearch } from './MemberSearch.js';

/**
 * El buscador global (§5.1.2). Lo usa alguien que tiene a una persona esperando
 * del otro lado del mostrador: se abre con el teclado, escribe y elige, sin
 * soltar las manos ni buscar el mouse.
 */
const RESULTADOS = [
  { memberId: 'mem_1', fullName: 'Micaela Sosa', hint: '30123456' },
  { memberId: 'mem_2', fullName: 'Micaela Paz', hint: '+542914567890' },
];

const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

let fetchMock: ReturnType<typeof vi.fn>;

function montar(onPick?: (member: { memberId: string }) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemberSearch client={api} {...(onPick ? { onPick } : {})} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(respuesta(RESULTADOS)));
});

describe('el atajo de teclado', () => {
  it('🔴 Ctrl+K abre el buscador y le da el foco al campo', async () => {
    montar();

    await userEvent.keyboard('{Control>}k{/Control}');

    const campo = await screen.findByLabelText('Buscar socio');
    expect(campo).toBe(document.activeElement);
  });

  it('Escape lo cierra', async () => {
    montar();
    await userEvent.keyboard('{Control>}k{/Control}');
    await screen.findByLabelText('Buscar socio');

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByLabelText('Buscar socio')).toBeNull();
  });

  it('también se abre con el botón, para quien usa el mouse', async () => {
    montar();

    await userEvent.click(screen.getByRole('button', { name: /Buscar socio/ }));

    expect(await screen.findByLabelText('Buscar socio')).toBeDefined();
  });
});

describe('la búsqueda', () => {
  const abrir = async () => {
    montar();
    await userEvent.keyboard('{Control>}k{/Control}');

    return screen.findByLabelText('Buscar socio');
  };

  it('encuentra por nombre y muestra con qué distinguir dos homónimos', async () => {
    const campo = await abrir();

    await userEvent.type(campo, 'Mica');

    expect(await screen.findByText('Micaela Sosa')).toBeDefined();
    expect(screen.getByText('30123456')).toBeDefined();
    expect(screen.getByText('+542914567890')).toBeDefined();
  });

  it('🔴 con una sola letra no busca: el resultado sería el padrón entero', async () => {
    const campo = await abrir();

    await userEvent.type(campo, 'M');

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it('sin resultados, lo dice', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(respuesta([])));
    const campo = await abrir();

    await userEvent.type(campo, 'Zzz');

    expect(await screen.findByText('Nadie con ese nombre.')).toBeDefined();
  });

  it('sin conexión, avisa en vez de quedarse mudo', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    const campo = await abrir();

    await userEvent.type(campo, 'Mica');

    expect(await screen.findByText(/Revisá la conexión|No pudimos buscar/)).toBeDefined();
  });

  it('elegir un socio avisa a quien montó el buscador', async () => {
    const elegido = vi.fn();
    montar(elegido);
    await userEvent.keyboard('{Control>}k{/Control}');
    const campo = await screen.findByLabelText('Buscar socio');
    await userEvent.type(campo, 'Mica');
    await screen.findByText('Micaela Sosa');

    await userEvent.click(screen.getByRole('button', { name: /Micaela Sosa/ }));

    expect(elegido).toHaveBeenCalledWith(RESULTADOS[0]);
  });
});
