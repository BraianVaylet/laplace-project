import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Button } from './Button.js';
import { FormField } from './form/FormField.js';
import { Input, Select, Textarea } from './form/Input.js';
import { Checkbox, Radio, RadioGroup } from './form/Choice.js';
import { ToastProvider, useToast } from './feedback/Toast.js';
import { EmptyState, ErrorState, Skeleton } from './feedback/states.js';
import { TBody, TD, TH, THead, TR, Table } from './data/Table.js';
import { Tabs } from './data/Tabs.js';
import { Badge, Card } from './layout/primitives.js';

/**
 * Auditoria de accesibilidad de toda la libreria. Spec §6: WCAG 2.2 AA es un
 * objetivo **verificable**, no una intencion. Si un componente rompe esto, no
 * cumple el DoD y no entra.
 */
async function expectNoViolations(ui: React.ReactElement) {
  const { container } = render(ui);
  const results = await axe(container, {
    rules: {
      /*
       * `color-contrast` necesita canvas para leer el color realmente pintado, y
       * jsdom no lo implementa: aca la regla no corre y pasa siempre, que es
       * peor que no tenerla. El contraste se verifica por calculo sobre los
       * tokens en `contrast.test.ts`, que ademas es exacto.
       */
      'color-contrast': { enabled: false },
    },
  });
  const violations = results.violations.map((v) => `${v.id}: ${v.help}`);

  expect(violations).toEqual([]);
}

describe('axe, componente por componente', () => {
  it('Button', async () => {
    await expectNoViolations(<Button>Reservar</Button>);
  });

  it('FormField con Input', async () => {
    await expectNoViolations(
      <FormField label="Nombre" description="Como figura en el documento" required>
        <Input placeholder="Micaela" />
      </FormField>,
    );
  });

  it('FormField con error', async () => {
    await expectNoViolations(
      <FormField label="Documento" error="Ya hay un miembro con ese documento.">
        <Input defaultValue="40123456" />
      </FormField>,
    );
  });

  it('Textarea', async () => {
    await expectNoViolations(
      <FormField label="Nota interna">
        <Textarea />
      </FormField>,
    );
  });

  it('Select', async () => {
    await expectNoViolations(
      <FormField label="Sede">
        <Select
          placeholder="Elegí una sede"
          options={[
            { value: 'ven_1', label: 'Centro' },
            { value: 'ven_2', label: 'Norte' },
          ]}
        />
      </FormField>,
    );
  });

  it('Checkbox y RadioGroup', async () => {
    await expectNoViolations(
      <div>
        <Checkbox label="Acepto el deslinde" description="Versión 2 del 01/03" />
        <RadioGroup legend="Política de cancelación">
          <Radio name="policy" label="2 horas antes" />
          <Radio name="policy" label="12 horas antes" />
        </RadioGroup>
      </div>,
    );
  });

  it('Table', async () => {
    await expectNoViolations(
      <Table caption="Miembros del centro">
        <THead>
          <TR>
            <TH>Nombre</TH>
            <TH>Estado</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Micaela</TD>
            <TD>
              <Badge tone="success">Activa</Badge>
            </TD>
          </TR>
        </TBody>
      </Table>,
    );
  });

  it('Tabs', async () => {
    await expectNoViolations(
      <Tabs
        label="Ficha del miembro"
        activeId="datos"
        onChange={() => undefined}
        items={[
          { id: 'datos', label: 'Datos', content: <p>Datos</p> },
          { id: 'contratos', label: 'Contratos', content: <p>Contratos</p> },
        ]}
      />,
    );
  });

  it('Skeleton, EmptyState y ErrorState', async () => {
    await expectNoViolations(
      <div>
        <Skeleton rows={3} />
        <EmptyState
          title="Todavía no tenés clases"
          description="Creá la primera y empezá a recibir reservas."
          action={<Button>Crear la primera</Button>}
        />
        <ErrorState
          message="La clase está completa."
          action="Podés sumarte a la lista de espera."
          code="LP-BOOK-409-002"
          requestId="req-abc"
        />
      </div>,
    );
  });

  it('Card', async () => {
    await expectNoViolations(
      <Card title="Estado de cuenta" actions={<Button size="sm">Cobrar</Button>}>
        <p>Saldo: $0</p>
      </Card>,
    );
  });
});

describe('el cableado del formulario, que es lo que todos olvidan', () => {
  it('el label apunta al control: hacerle clic lo enfoca', async () => {
    render(
      <FormField label="Nombre">
        <Input />
      </FormField>,
    );

    await userEvent.click(screen.getByText('Nombre'));

    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('la ayuda se LEE junto al campo, no solo se muestra', () => {
    render(
      <FormField label="Documento" description="Sin puntos ni espacios">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox');
    const describedBy = input.getAttribute('aria-describedby') ?? '';

    expect(describedBy.length).toBeGreaterThan(0);
    expect(document.getElementById(describedBy.split(' ')[0] as string)?.textContent).toBe(
      'Sin puntos ni espacios',
    );
  });

  it('el error marca el campo como invalido y queda asociado', () => {
    render(
      <FormField label="Documento" error="Ya existe">
        <Input />
      </FormField>,
    );

    const input = screen.getByRole('textbox');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(
      screen.getByRole('alert').getAttribute('id'),
    );
  });

  it('sin error, el campo no dice estar invalido', () => {
    render(
      <FormField label="Nombre">
        <Input />
      </FormField>,
    );

    expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
  });

  it('el error se anuncia al aparecer, no cuando el usuario vuelve al campo', () => {
    render(
      <FormField label="Documento" error="Ya existe">
        <Input />
      </FormField>,
    );

    expect(screen.getByRole('alert').textContent).toBe('Ya existe');
  });

  it('required se comunica al lector, no solo con un asterisco visual', () => {
    render(
      <FormField label="Nombre" required>
        <Input />
      </FormField>,
    );

    expect(screen.getByRole('textbox').getAttribute('aria-required')).toBe('true');
  });

  it('el Select con placeholder no miente: sin elegir, el valor es vacio', () => {
    render(
      <FormField label="Sede">
        <Select placeholder="Elegí una sede" options={[{ value: 'ven_1', label: 'Centro' }]} />
      </FormField>,
    );

    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });

  it('el RadioGroup agrupa: el lector sabe de que pregunta son respuesta', () => {
    render(
      <RadioGroup legend="Política de cancelación">
        <Radio name="p" label="2 horas" />
        <Radio name="p" label="12 horas" />
      </RadioGroup>,
    );

    expect(screen.getByRole('group', { name: 'Política de cancelación' })).toBeDefined();
  });
});

describe('targets tactiles', () => {
  it('los controles miden al menos 44px de alto (h-11)', () => {
    render(
      <div>
        <Button>Reservar</Button>
        <FormField label="Nombre">
          <Input />
        </FormField>
      </div>,
    );

    expect(screen.getByRole('button').className).toContain('h-11');
    expect(screen.getByRole('textbox').className).toContain('h-11');
  });

  it('los inputs usan 16px: por debajo, iOS hace zoom y descoloca el layout', () => {
    render(
      <FormField label="Nombre">
        <Input />
      </FormField>,
    );

    expect(screen.getByRole('textbox').className).toContain('text-input');
  });
});

describe('Tabs por teclado', () => {
  function ControlledTabs() {
    const [active, setActive] = useState('datos');
    return (
      <Tabs
        label="Ficha"
        activeId={active}
        onChange={setActive}
        items={[
          { id: 'datos', label: 'Datos', content: <p>Contenido de datos</p> },
          { id: 'contratos', label: 'Contratos', content: <p>Contenido de contratos</p> },
          { id: 'asistencia', label: 'Asistencia', content: <p>Contenido de asistencia</p> },
        ]}
      />
    );
  }

  it('solo la pestaña activa entra en el orden de tabulacion (roving tabindex)', () => {
    render(<ControlledTabs />);
    const tabs = screen.getAllByRole('tab');

    expect(tabs[0]?.getAttribute('tabindex')).toBe('0');
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1');
    expect(tabs[2]?.getAttribute('tabindex')).toBe('-1');
  });

  it('la flecha derecha avanza', async () => {
    render(<ControlledTabs />);
    screen.getAllByRole('tab')[0]?.focus();

    await userEvent.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Contratos' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('desde la ultima, la derecha vuelve a la primera', async () => {
    render(<ControlledTabs />);
    screen.getAllByRole('tab')[0]?.focus();

    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');

    expect(screen.getByRole('tab', { name: 'Datos' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Home y End van a los extremos', async () => {
    render(<ControlledTabs />);
    screen.getAllByRole('tab')[0]?.focus();

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Asistencia' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Datos' }).getAttribute('aria-selected')).toBe('true');
  });

  it('el panel esta asociado a su pestaña', () => {
    render(<ControlledTabs />);

    const panel = screen.getByRole('tabpanel');
    const tab = screen.getByRole('tab', { name: 'Datos' });

    expect(panel.getAttribute('aria-labelledby')).toBe(tab.getAttribute('id'));
    expect(tab.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
  });

  it('solo se renderiza el panel activo', () => {
    render(<ControlledTabs />);

    expect(screen.getByText('Contenido de datos')).toBeDefined();
    expect(screen.queryByText('Contenido de contratos')).toBeNull();
  });
});

describe('estados de carga, vacio y error', () => {
  it('el skeleton se anuncia como cargando, no queda mudo', () => {
    render(<Skeleton rows={3} />);

    expect(screen.getByRole('status', { name: 'Cargando' })).toBeDefined();
  });

  it('el estado vacio siempre trae la accion que lo resuelve', () => {
    render(
      <EmptyState title="Todavía no tenés clases" action={<Button>Crear la primera</Button>} />,
    );

    expect(screen.getByRole('button', { name: 'Crear la primera' })).toBeDefined();
  });

  it('el error muestra el codigo y el requestId para compartir con soporte', () => {
    render(
      <ErrorState message="La clase está completa." code="LP-BOOK-409-002" requestId="req-abc" />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('LP-BOOK-409-002');
    expect(alert.textContent).toContain('req-abc');
  });

  it('el error dice que puede hacer el usuario, no solo que fallo', () => {
    render(
      <ErrorState message="La clase está completa." action="Podés sumarte a la lista de espera." />,
    );

    expect(screen.getByRole('alert').textContent).toContain('lista de espera');
  });

  it('el error se anuncia solo: es un alert, no un parrafo cualquiera', () => {
    render(<ErrorState message="Algo falló" />);

    expect(screen.getByRole('alert')).toBeDefined();
  });
});

describe('Toast', () => {
  function Harness() {
    const { show } = useToast();
    return (
      <button
        type="button"
        onClick={() => show({ message: 'Reserva confirmada', tone: 'success' })}
      >
        Reservar
      </button>
    );
  }

  it('el aviso aparece y se anuncia', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reservar' }));

    expect(screen.getByRole('status').textContent).toContain('Reserva confirmada');
  });

  it('un aviso de error usa alert, que interrumpe', async () => {
    function ErrorHarness() {
      const { show } = useToast();
      return (
        <button
          type="button"
          onClick={() =>
            show({ message: 'No te quedan clases', tone: 'danger', code: 'LP-CTRT-402-001' })
          }
        >
          Reservar
        </button>
      );
    }

    render(
      <ToastProvider>
        <ErrorHarness />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reservar' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No te quedan clases');
    expect(alert.textContent).toContain('LP-CTRT-402-001');
  });

  it('se puede cerrar', async () => {
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reservar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('usarlo sin provider avisa claro en vez de fallar raro', () => {
    expect(() => render(<Harness />)).toThrowError(/ToastProvider/);
  });
});
