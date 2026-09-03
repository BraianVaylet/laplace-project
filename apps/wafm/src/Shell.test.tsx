import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Home } from './Home.js';
import { Shell } from './Shell.js';

/**
 * Shell de la WAFM (§5.1.3). Mobile first: la navegacion va abajo en el
 * telefono, que es donde llega el pulgar.
 */
function renderShell() {
  return render(
    <Shell>
      <Home />
    </Shell>,
  );
}

describe('shell de la WAFM', () => {
  it('tiene header y navegacion', () => {
    renderShell();

    expect(screen.getByRole('banner')).toBeDefined();
    expect(
      screen.getAllByRole('navigation', { name: 'Navegación principal' }).length,
    ).toBeGreaterThan(0);
  });

  it('la navegacion existe dos veces: bottom nav en mobile, barra superior desde 768px', () => {
    renderShell();

    // Las dos estan en el DOM y CSS decide cual se ve. Es lo que permite cumplir
    // a la vez lo que pide §5.1.3 y lo que recomienda su `[+]`.
    expect(screen.getAllByRole('navigation', { name: 'Navegación principal' })).toHaveLength(2);
  });

  it('Mi QR esta en la navegacion: es lo que abre la puerta, a 1 tap', () => {
    renderShell();

    expect(screen.getAllByRole('link', { name: 'Mi QR' }).length).toBeGreaterThan(0);
  });

  it('estan las secciones del socio', () => {
    renderShell();

    for (const label of ['Inicio', 'Horario', 'Mis packs', 'Mi QR', 'Perfil']) {
      expect(screen.getAllByRole('link', { name: label }).length, label).toBeGreaterThan(0);
    }
  });

  it('sin reservas, dice que hacer', () => {
    renderShell();

    expect(screen.getByRole('button', { name: 'Ver horario' })).toBeDefined();
  });
});
