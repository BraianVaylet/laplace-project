import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';

/** Shell del DFSM: §5.1.2 pide header, panel lateral colapsable y footer. */
describe('shell del DFSM', () => {
  it('tiene header, navegacion principal y footer', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('el panel lateral se puede comprimir para ganar espacio', async () => {
    render(<App />);
    const toggle = screen.getByRole('button', { name: /panel lateral/i });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('los modulos del centro estan en la navegacion', () => {
    render(<App />);

    for (const label of ['Hoy', 'Horario', 'Miembros', 'Productos', 'Cobranza', 'Métricas']) {
      expect(screen.getByRole('link', { name: label }), label).toBeDefined();
    }
  });

  it('el selector de Venue NO aparece con un solo centro: seria ruido', () => {
    render(<App />);

    expect(screen.queryByLabelText('Centro activo')).toBeNull();
  });

  it('se puede cambiar el tema desde el header', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /tema/i })).toBeDefined();
  });

  it('la pantalla vacia trae la accion que la resuelve', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Crear la primera' })).toBeDefined();
  });
});
