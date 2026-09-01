import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Layout } from '../Layout.js';
import { Home } from './Home.js';
import { Privacy } from './Privacy.js';
import { Terms } from './Terms.js';

/**
 * Complementa a `ssg.test.ts`, no lo duplica: aquel verifica que el contenido
 * llegue **en el HTML servido**, que es lo que ve el buscador; este verifica la
 * estructura y los roles, que es lo que ve un lector de pantalla.
 */
/**
 * El `<Head>` del Layout usa react-helmet-async, que necesita su provider. En la
 * app real lo pone `vite-react-ssg`; aca hay que ponerlo a mano.
 */
const inRouter = (ui: React.ReactElement, path = '/') =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </HelmetProvider>,
  );

describe('home', () => {
  it('tiene un solo h1 y dice de que se trata el producto', () => {
    render(<Home />);

    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]?.textContent).toContain('centro deportivo');
  });

  it('el CTA principal es la prueba, no un "contactanos"', () => {
    render(<Home />);

    expect(screen.getByRole('button', { name: 'Empezar la prueba' })).toBeDefined();
  });

  it('dice que la prueba es sin tarjeta (ADR-004, decision 5)', () => {
    render(<Home />);

    expect(screen.getByText(/sin tarjeta/i)).toBeDefined();
  });

  it('nombra las disciplinas de §1: no es solo para CrossFit', () => {
    render(<Home />);
    const texto = screen.getByText(/boxes de CrossFit/i).textContent ?? '';

    expect(texto).toContain('pilates');
    expect(texto).toContain('gimnasios');
  });

  it('las secciones de §5.1.4 tienen ancla propia para el menu', () => {
    const { container } = render(<Home />);

    for (const id of ['producto', 'funcionalidades', 'precios', 'faq', 'contacto']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  it('los encabezados de seccion son h2, no divs con letra grande', () => {
    render(<Home />);

    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(4);
  });

  it('las preguntas usan una lista de definiciones, que es lo que son', () => {
    const { container } = render(<Home />);

    expect(container.querySelectorAll('dt').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('dd').length).toBeGreaterThan(0);
  });
});

describe('paginas legales', () => {
  it('privacidad nombra la ley que aplica y el rol de cada parte (§9.2)', () => {
    render(<Privacy />);

    expect(screen.getByText(/25\.326/)).toBeDefined();
    expect(screen.getByText(/responsable del tratamiento/i)).toBeDefined();
  });

  it('terminos aclara que el texto vigente se sirve versionado, no hardcodeado', () => {
    render(<Terms />);

    expect(screen.getByText(/versionado/i)).toBeDefined();
  });

  it('cada legal tiene su h1', () => {
    render(<Privacy />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('layout', () => {
  it('tiene header, main y footer', () => {
    inRouter(<Layout />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('main')).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('el menu lleva a las secciones de la home, con ancla absoluta', () => {
    inRouter(<Layout />);

    // `/#precios` y no `#precios`: desde /terminos, el ancla relativa no
    // llevaria a ningun lado.
    expect(screen.getByRole('link', { name: 'Precios' }).getAttribute('href')).toBe('/#precios');
  });

  it('da acceso a las apps con sesion', () => {
    inRouter(<Layout />);

    expect(screen.getByRole('link', { name: 'Ingresar' })).toBeDefined();
  });

  it('los legales estan en el footer, agrupados y con nombre', () => {
    inRouter(<Layout />);

    const legales = screen.getByRole('navigation', { name: 'Legales' });
    expect(legales.textContent).toContain('Términos');
    expect(legales.textContent).toContain('Privacidad');
  });

  it('el CTA esta siempre visible en el header', () => {
    inRouter(<Layout />);

    expect(screen.getByRole('button', { name: 'Probar gratis' })).toBeDefined();
  });

  it('funciona en una ruta legal, no solo en la home', () => {
    inRouter(<Layout />, '/privacidad');

    expect(screen.getByRole('banner')).toBeDefined();
  });
});
