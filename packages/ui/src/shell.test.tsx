import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button.js';
import { Dialog } from './feedback/Dialog.js';
import { ThemeProvider, resolveTheme, useTheme } from './theme.js';

afterEach(() => {
  globalThis.localStorage?.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('Dialog', () => {
  function Harness({ dismissOnBackdrop = true }: { dismissOnBackdrop?: boolean }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Cancelar reserva</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Cancelar la reserva"
          description="Pasó el plazo: no se devuelve el crédito."
          dismissOnBackdrop={dismissOnBackdrop}
          footer={<Button onClick={() => setOpen(false)}>Confirmar</Button>}
        >
          <p>Clase de Funcional, hoy 19:00.</p>
        </Dialog>
      </div>
    );
  }

  it('arranca cerrado', () => {
    render(<Harness />);

    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('open')).toBeNull();
  });

  it('se abre y muestra el titulo, la descripcion y el contenido', async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Cancelar la reserva');
    expect(dialog.textContent).toContain('no se devuelve el crédito');
    expect(dialog.textContent).toContain('Funcional');
  });

  it('el titulo y la descripcion estan asociados al dialogo, no solo escritos adentro', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    const dialog = screen.getByRole('dialog');
    const titleId = dialog.getAttribute('aria-labelledby');
    const descId = dialog.getAttribute('aria-describedby');

    expect(document.getElementById(titleId as string)?.textContent).toBe('Cancelar la reserva');
    expect(document.getElementById(descId as string)?.textContent).toContain(
      'no se devuelve el crédito',
    );
  });

  it('el boton del footer lo cierra', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('open')).toBeNull();
  });

  it('el clic en el backdrop lo cierra', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    // El clic sobre el backdrop llega con el <dialog> como target.
    await userEvent.click(screen.getByRole('dialog'));

    expect(screen.getByRole('dialog', { hidden: true }).getAttribute('open')).toBeNull();
  });

  it('un flujo destructivo puede pedir que el backdrop NO cierre', async () => {
    render(<Harness dismissOnBackdrop={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    await userEvent.click(screen.getByRole('dialog'));

    expect(screen.getByRole('dialog').getAttribute('open')).not.toBeNull();
  });

  it('un clic adentro del contenido no lo cierra', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar reserva' }));

    await userEvent.click(screen.getByText('Clase de Funcional, hoy 19:00.'));

    expect(screen.getByRole('dialog').getAttribute('open')).not.toBeNull();
  });

  it('el estado del padre se entera del cierre: no queda diciendo "abierto"', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Confirmar">
        <p>Contenido</p>
      </Dialog>,
    );

    // Es lo que hace el navegador al apretar Escape.
    (screen.getByRole('dialog') as HTMLDialogElement).close();

    expect(onClose).toHaveBeenCalled();
  });
});

describe('tema', () => {
  function Harness() {
    const { theme, resolved, setTheme } = useTheme();
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="resolved">{resolved}</span>
        <button type="button" onClick={() => setTheme('light')}>
          Claro
        </button>
        <button type="button" onClick={() => setTheme('dark')}>
          Oscuro
        </button>
        <button type="button" onClick={() => setTheme('system')}>
          Sistema
        </button>
      </div>
    );
  }

  it('arranca en system, que sigue al sistema operativo', () => {
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('system');
  });

  it('sin preferencia del sistema resuelve a dark: la spec es dark-first', () => {
    expect(resolveTheme('system')).toBe('dark');
  });

  it('cambiar el tema lo escribe en el documento, que es lo que lee el CSS', async () => {
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Claro' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('la eleccion se recuerda entre sesiones', async () => {
    const { unmount } = render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Claro' }));
    unmount();

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('system es un tercer estado real, no un sinonimo de dark', async () => {
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Claro' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sistema' }));

    expect(screen.getByTestId('theme').textContent).toBe('system');
  });

  it('resolveTheme devuelve tal cual lo que no es system', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
  });

  it('usarlo sin provider avisa claro', () => {
    expect(() => render(<Harness />)).toThrowError(/ThemeProvider/);
  });

  it('que no se pueda guardar la preferencia no rompe la app', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('modo privado');
    });

    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Claro' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    setItem.mockRestore();
  });
});
