import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useUiStore } from '@laplace/client';
import { VenueSelector } from './VenueSelector.js';

const VENUES = [
  { id: 'ven_centro', name: 'Centro' },
  { id: 'ven_norte', name: 'Norte' },
];

afterEach(() => {
  globalThis.localStorage.clear();
  useUiStore.setState({ activeVenueId: null });
});

describe('selector de centro', () => {
  it('no aparece con una sola sede: seria un desplegable de una opcion', () => {
    render(<VenueSelector venues={[VENUES[0] as (typeof VENUES)[number]]} />);

    expect(screen.queryByLabelText('Centro activo')).toBeNull();
  });

  it('no aparece sin sedes', () => {
    render(<VenueSelector venues={[]} />);

    expect(screen.queryByLabelText('Centro activo')).toBeNull();
  });

  it('con dos o mas, muestra todas', () => {
    render(<VenueSelector venues={VENUES} />);

    expect(screen.getByRole('option', { name: 'Centro' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Norte' })).toBeDefined();
  });

  it('sin eleccion previa, arranca en la primera', () => {
    render(<VenueSelector venues={VENUES} />);

    expect((screen.getByLabelText('Centro activo') as HTMLSelectElement).value).toBe('ven_centro');
  });

  it('cambiar de centro cambia el contexto activo', async () => {
    render(<VenueSelector venues={VENUES} />);

    await userEvent.selectOptions(screen.getByLabelText('Centro activo'), 'ven_norte');

    expect(useUiStore.getState().activeVenueId).toBe('ven_norte');
  });

  it('el centro elegido persiste entre recargas (§5.1.2)', async () => {
    const { unmount } = render(<VenueSelector venues={VENUES} />);
    await userEvent.selectOptions(screen.getByLabelText('Centro activo'), 'ven_norte');
    unmount();

    render(<VenueSelector venues={VENUES} />);

    expect((screen.getByLabelText('Centro activo') as HTMLSelectElement).value).toBe('ven_norte');
  });

  it('tiene label accesible aunque no se vea', () => {
    render(<VenueSelector venues={VENUES} />);

    expect(screen.getByRole('combobox', { name: 'Centro activo' })).toBeDefined();
  });
});
