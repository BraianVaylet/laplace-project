import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Shell } from './Shell.js';

/** Shell del DFSM: §5.1.2 pide header, panel lateral colapsable y footer. */
describe('shell del DFSM', () => {
  it('tiene header, navegacion principal y footer', () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('el panel lateral se puede comprimir para ganar espacio', async () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );
    const toggle = screen.getByRole('button', { name: /panel lateral/i });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('los modulos del centro estan en la navegacion', () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );

    for (const label of ['Hoy', 'Horario', 'Miembros', 'Productos', 'Cobranza', 'Métricas']) {
      expect(screen.getByRole('link', { name: label }), label).toBeDefined();
    }
  });

  it('el selector de Venue NO aparece con un solo centro: seria ruido', () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );

    expect(screen.queryByLabelText('Centro activo')).toBeNull();
  });

  it('se puede cambiar el tema desde el header', () => {
    render(
      <Shell>
        <p>contenido</p>
      </Shell>,
    );

    expect(screen.getByRole('button', { name: /tema/i })).toBeDefined();
  });

  it('el contenido de la pantalla se renderiza adentro del shell', () => {
    // El estado vacio del tablero lo prueba `Home.test`, que es de quien es:
    // el shell solo tiene que no comerse lo que le ponen adentro.
    render(
      <Shell>
        <button type="button">Crear la primera</button>
      </Shell>,
    );

    expect(screen.getByRole('button', { name: 'Crear la primera' })).toBeDefined();
  });
});
