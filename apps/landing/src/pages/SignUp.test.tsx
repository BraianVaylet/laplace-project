import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createApiClient } from '@laplace/client';
import { SignUp } from './SignUp.js';

/**
 * F1-38. La puerta de entrada del producto.
 *
 * 🔴 Lo que se prueba: que el alta sea **una sola cosa para quien la hace**.
 * Por debajo son dos llamadas —la cuenta y la suscripción—, y si la segunda
 * falla queda una cuenta sin centro: alguien que se registró y no es cliente de
 * nada. Eso se dice, no se esconde.
 */
const respuesta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
  });

const error = (code: string, message: string, status: number, action?: string) =>
  respuesta(
    {
      success: false,
      error: { code, message, ...(action ? { action } : {}), requestId: 'r', timestamp: 't' },
    },
    status,
  );

const PLANES = {
  items: [
    { planId: 'basic', name: 'Basic', priceCents: 2_500_000 },
    { planId: 'pro', name: 'Pro', priceCents: 4_500_000 },
    { planId: 'max', name: 'Max', priceCents: 7_500_000 },
  ],
};

const porDefecto = (url: string) => {
  if (url.includes('/plans')) return respuesta(PLANES.items);
  if (url.includes('/subscribers')) {
    return respuesta({ organizationId: 'org_1', centerName: 'Box Toro', status: 'trial' }, 201);
  }

  return respuesta({ token: 't', user: { id: 'usr_1' } });
};

let fetchMock: ReturnType<typeof vi.fn>;

function montar(plan?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createApiClient({
    baseUrl: 'http://localhost:3000/api/v1',
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SignUp client={client} {...(plan ? { planPreseleccionado: plan } : {})} />
    </QueryClientProvider>,
  );
}

async function completar() {
  await userEvent.type(screen.getByLabelText(/Tu nombre/), 'Braian');
  await userEvent.type(screen.getByLabelText(/Tu email/), 'braian@boxtoro.test');
  await userEvent.type(screen.getByLabelText(/Elegí una clave/), 'unaClaveLargaYSegura123');
  await userEvent.type(screen.getByLabelText(/Nombre de tu centro/), 'Box Toro');
}

const llamadaA = (fragmento: string) =>
  fetchMock.mock.calls.find(([url]) => String(url).includes(fragmento));

beforeEach(() => {
  fetchMock = vi.fn((url: string) => Promise.resolve(porDefecto(String(url))));
});

describe('el alta', () => {
  it('pide lo mínimo: quién sos y cómo se llama tu centro', async () => {
    montar();

    expect(await screen.findByLabelText(/Tu nombre/)).toBeDefined();
    expect(screen.getByLabelText(/Tu email/)).toBeDefined();
    expect(screen.getByLabelText(/Elegí una clave/)).toBeDefined();
    expect(screen.getByLabelText(/Nombre de tu centro/)).toBeDefined();
  });

  it('🔴 no pide tarjeta, y lo dice', async () => {
    // ADR-004: pedirla acá es la forma más rápida de perder a quien quería
    // probar.
    montar();

    expect(await screen.findByText(/sin tarjeta/i)).toBeDefined();
  });

  it('crea la cuenta y después el centro', async () => {
    montar();
    await screen.findByLabelText(/Tu nombre/);
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Crear mi centro' }));

    await waitFor(() => {
      expect(llamadaA('/auth/sign-up/email')).toBeDefined();
      const alta = llamadaA('/subscribers');
      expect(JSON.parse(String((alta?.[1] as RequestInit).body))).toMatchObject({
        centerName: 'Box Toro',
      });
    });
  });

  it('🔴 deja el centro activo en la sesión', async () => {
    // Sin esto, quien se acaba de registrar entra al DFSM sin centro elegido y
    // la API le contesta 403 a todo.
    montar();
    await screen.findByLabelText(/Tu nombre/);
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Crear mi centro' }));

    await waitFor(() => {
      const activar = llamadaA('/auth/organization/set-active');
      expect(JSON.parse(String((activar?.[1] as RequestInit).body))).toMatchObject({
        organizationId: 'org_1',
      });
    });
  });

  it('al terminar dice adónde sigue y con qué usuario', async () => {
    montar();
    await screen.findByLabelText(/Tu nombre/);
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Crear mi centro' }));

    expect(await screen.findByText(/Box Toro/)).toBeDefined();
    expect(screen.getByText(/braian@boxtoro.test/)).toBeDefined();
  });
});

describe('el plan', () => {
  it('viene preseleccionado el que se eligió en la tabla de precios', async () => {
    montar('max');

    await waitFor(() =>
      expect((screen.getByLabelText(/Plan/) as HTMLSelectElement).value).toBe('max'),
    );
  });

  it('sin elección previa arranca en Pro, y se puede cambiar', async () => {
    montar();

    await waitFor(() =>
      expect((screen.getByLabelText(/Plan/) as HTMLSelectElement).value).toBe('pro'),
    );

    await userEvent.selectOptions(screen.getByLabelText(/Plan/), 'basic');
    await completar();
    await userEvent.click(screen.getByRole('button', { name: 'Crear mi centro' }));

    await waitFor(() =>
      expect(JSON.parse(String((llamadaA('/subscribers')?.[1] as RequestInit).body))).toMatchObject(
        {
          planId: 'basic',
        },
      ),
    );
  });
});

describe('el plan que viene de la tabla de precios', () => {
  it('🔴 sale de la URL: la página es estática y la comparte todo el mundo', async () => {
    // Se prerenderiza una sola vez para todos, así que el plan elegido no puede
    // venir horneado en el HTML.
    window.history.replaceState({}, '', '/empezar?plan=max');
    montar();

    await waitFor(() =>
      expect((screen.getByLabelText(/Plan/) as HTMLSelectElement).value).toBe('max'),
    );

    window.history.replaceState({}, '', '/empezar');
  });

  it('un plan inventado en la URL cae al default', async () => {
    window.history.replaceState({}, '', '/empezar?plan=gratis-para-siempre');
    montar();

    await waitFor(() =>
      expect((screen.getByLabelText(/Plan/) as HTMLSelectElement).value).toBe('pro'),
    );

    window.history.replaceState({}, '', '/empezar');
  });
});

describe('🔴 cuando algo sale mal', () => {
  it('el email ya registrado se dice, y se ofrece entrar', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/auth/sign-up/email')
          ? error(
              'LP-AUTH-409-009',
              'Ese email ya tiene una cuenta.',
              409,
              'Probá recuperar la contraseña.',
            )
          : porDefecto(String(url)),
      ),
    );
    montar();
    await screen.findByLabelText(/Tu nombre/);
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Crear mi centro' }));

    expect(await screen.findByText('Ese email ya tiene una cuenta.')).toBeDefined();
    expect(screen.getByText('Probá recuperar la contraseña.')).toBeDefined();
  });

  it('🔴 si la cuenta se creó y el centro no, lo dice: no queda en el aire', async () => {
    /*
     * Son dos llamadas. Si la segunda falla, quedó una cuenta sin centro:
     * alguien que se registró y no es cliente de nada. Decir "algo salió mal" y
     * mandarlo de nuevo al formulario lo haría chocar contra "ese email ya
     * existe" sin entender por qué.
     */
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/subscribers')
          ? error('LP-SUSC-409-002', 'Ya hay una cuenta con ese nombre.', 409)
          : porDefecto(String(url)),
      ),
    );
    montar();
    await screen.findByLabelText(/Tu nombre/);
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Crear mi centro' }));

    expect(await screen.findByText('Ya hay una cuenta con ese nombre.')).toBeDefined();
    expect(screen.getByText(/Tu cuenta ya está creada/i)).toBeDefined();
  });

  it('la clave corta se avisa antes de enviar', async () => {
    montar();

    const clave = await screen.findByLabelText(/Elegí una clave/);
    expect(clave.getAttribute('minLength')).toBe('8');
    expect(screen.getByText(/al menos 8/i)).toBeDefined();
  });
});
