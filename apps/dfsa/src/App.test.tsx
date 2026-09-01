import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

/** Shell del DFSA (§5.1.1). Es la herramienta del super admin. */
describe('shell del DFSA', () => {
  it('tiene la estructura de §5.1.1: header, panel lateral y footer', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeDefined();
    expect(screen.getByRole('contentinfo')).toBeDefined();
  });

  it('estan los modulos del SAU', () => {
    render(<App />);

    for (const label of [
      'Suscriptores',
      'Planes',
      'Ejercicios',
      'Textos legales',
      'Salud del sistema',
    ]) {
      expect(screen.getByRole('link', { name: label }), label).toBeDefined();
    }
  });

  it('el panel lateral se comprime', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /panel lateral/i })).toBeDefined();
  });
});
