import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

/** Shell de la landing (§5.1.4). Publica, sin sesion. */
describe('shell de la landing', () => {
  it('tiene un solo h1: es lo que lee el buscador primero', () => {
    render(<App />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('el header navega a las secciones de §5.1.4', () => {
    render(<App />);

    for (const label of ['Producto', 'Funcionalidades', 'Precios', 'Preguntas', 'Contacto']) {
      expect(screen.getByRole('link', { name: label }), label).toBeDefined();
    }
  });

  it('da acceso a las apps con sesion', () => {
    render(<App />);

    expect(screen.getByRole('link', { name: 'Ingresar' })).toBeDefined();
  });

  it('el CTA principal es la prueba gratis sin tarjeta (ADR-004)', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: 'Probar gratis' })).toBeDefined();
    expect(screen.getByText(/sin\s+tarjeta/i)).toBeDefined();
  });
});
