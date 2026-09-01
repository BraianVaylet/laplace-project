import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button.js';

describe('Button', () => {
  it('renderiza el contenido y es alcanzable por su rol', () => {
    render(<Button>Reservar</Button>);
    expect(screen.getByRole('button', { name: 'Reservar' })).toBeDefined();
  });

  it('respeta el target tactil minimo de 44px (h-11)', () => {
    render(<Button size="sm">Chico</Button>);
    expect(screen.getByRole('button').className).toContain('h-11');
  });

  it('queda inerte cuando esta deshabilitado', () => {
    render(<Button disabled>Guardar</Button>);
    expect(screen.getByRole('button')).toHaveProperty('disabled', true);
  });
});
