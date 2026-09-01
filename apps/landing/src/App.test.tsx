import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App.js';

describe('App', () => {
  it('renderiza el titulo de la aplicacion', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
  });
});
