import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createApiClient } from '@laplace/client';
import { LANDING_PLANS } from '@laplace/schemas';
import { ContactForm } from './ContactForm.js';
import { Pricing } from './Pricing.js';
import { Social } from './Social.js';
import { Testimonials } from './Testimonials.js';
import { VsExcel } from './VsExcel.js';

/**
 * Las secciones de §5.1.4. Lo que importa acá es lo que el visitante puede
 * hacer y lo que el buscador puede leer — no cómo se ve.
 */
describe('los precios', () => {
  it('🔴 los números están en el HTML, no detrás de un fetch', () => {
    // Quien llega de una búsqueda compara precios antes de tocar nada.
    render(<Pricing />);

    expect(screen.getByText('$25.000')).toBeDefined();
    expect(screen.getByText('$45.000')).toBeDefined();
    expect(screen.getByText('$75.000')).toBeDefined();
  });

  it('están los tres planes, con lo que incluye cada uno', () => {
    render(<Pricing />);

    for (const plan of LANDING_PLANS) {
      expect(screen.getByRole('heading', { name: plan.name })).toBeDefined();
    }
    expect(screen.getByText('Check-in con QR')).toBeDefined();
  });

  it('dice que la prueba no pide tarjeta', () => {
    render(<Pricing />);

    expect(screen.getByText(/sin tarjeta/)).toBeDefined();
  });
});

describe('la comparativa', () => {
  it('🔴 compara contra Excel y WhatsApp, que es el competidor real', () => {
    render(<VsExcel />);

    expect(screen.getByRole('columnheader', { name: 'Con Excel y WhatsApp' })).toBeDefined();
  });

  it('la tabla tiene encabezados de fila y de columna', () => {
    render(<VsExcel />);

    // Sin `scope`, un lector de pantalla lee una grilla de celdas sueltas.
    expect(screen.getByRole('rowheader', { name: 'Saber quién debe' })).toBeDefined();
  });
});

describe('los testimonios', () => {
  it('🔴 sin testimonios reales no inventa ninguno', () => {
    // Un testimonio inventado es una reseña falsa: quien la lee decide con eso.
    render(<Testimonials />);

    expect(screen.getByText(/Todavía no publicamos testimonios/)).toBeDefined();
  });

  it('con testimonios, el carousel se mueve con botones de verdad', async () => {
    render(
      <Testimonials
        items={[
          { quote: 'Nos sacó el WhatsApp de encima.', author: 'Ana', center: 'Box Uno' },
          { quote: 'La cobranza dejó de ser un problema.', author: 'Beto', center: 'Box Dos' },
        ]}
      />,
    );

    expect(screen.getByText('Nos sacó el WhatsApp de encima.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Testimonio siguiente' }));
    expect(screen.getByText('La cobranza dejó de ser un problema.')).toBeDefined();
  });

  it('el testimonio se anuncia al lector de pantalla', () => {
    render(<Testimonials items={[{ quote: 'Anda bien.', author: 'Ana', center: 'Box Uno' }]} />);

    expect(screen.getByText('Anda bien.').closest('[aria-live]')).not.toBeNull();
  });
});

describe('las redes', () => {
  it('🔴 los enlaces que abren en otra pestaña llevan rel="noopener"', () => {
    // Sin él, la página que se abre puede manipular la nuestra por `window.opener`.
    render(<Social />);

    for (const enlace of screen.getAllByRole('link')) {
      expect(enlace.getAttribute('rel')).toContain('noopener');
    }
  });
});

describe('el formulario de contacto', () => {
  const respuesta = (body: unknown, status = 201) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-test' },
    });

  let fetchMock: ReturnType<typeof vi.fn>;

  const montar = () => {
    const client = createApiClient({
      baseUrl: 'http://localhost:3000/api/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    return render(<ContactForm client={client} />);
  };

  const completar = async () => {
    await userEvent.type(screen.getByLabelText(/Tu nombre/), 'Braian');
    await userEvent.type(screen.getByLabelText(/Tu mail/), 'braian@boxtoro.test');
    await userEvent.type(
      screen.getByLabelText(/Tu mensaje/),
      'Tengo un box de 40 socios y quiero saber cuánto sale.',
    );
  };

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(respuesta({ received: true })));
  });

  it('envía y agradece', async () => {
    montar();
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Gracias')).toBeDefined();
  });

  it('🔴 valida con el mismo schema que el servidor, antes de mandar', async () => {
    montar();
    await userEvent.type(screen.getByLabelText(/Tu nombre/), 'Braian');
    await userEvent.type(screen.getByLabelText(/Tu mail/), 'esto-no-es-un-mail');
    await userEvent.type(screen.getByLabelText(/Tu mensaje/), 'corto');

    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Revisá el mail.')).toBeDefined();
    expect(screen.getByText('Contanos algo más.')).toBeDefined();
    // No se molesta al servidor con algo que ya sabemos que está mal.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('🔴 la trampa para bots está escondida y fuera del tabulador', () => {
    montar();

    const trampa = document.querySelector<HTMLInputElement>('input[name="website"]');

    expect(trampa).not.toBeNull();
    expect(trampa?.tabIndex).toBe(-1);
    expect(trampa?.closest('[hidden]')).not.toBeNull();
  });

  it('si la API falla, lo dice en vez de quedarse mudo', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('sin red')));
    montar();
    await completar();

    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
  });
});
