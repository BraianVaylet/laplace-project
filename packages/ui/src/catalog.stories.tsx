import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Button } from './Button.js';
import { FormField } from './form/FormField.js';
import { Input, Select, Textarea } from './form/Input.js';
import { Checkbox, Radio, RadioGroup } from './form/Choice.js';
import { Dialog } from './feedback/Dialog.js';
import { ToastProvider, useToast } from './feedback/Toast.js';
import { EmptyState, ErrorState, Skeleton } from './feedback/states.js';
import { TBody, TD, TH, THead, TR, Table } from './data/Table.js';
import { Tabs } from './data/Tabs.js';
import { Badge, Card } from './layout/primitives.js';

/**
 * El catalogo de `@laplace/ui`.
 *
 * Los ejemplos usan datos de un centro real, no "Lorem ipsum": un boton se ve
 * distinto con "Reservar" que con "Button", y una tabla con nombres largos
 * revela problemas de layout que una con "Foo" esconde.
 */
const meta: Meta = {
  title: 'Laplace/Catálogo',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

export const Botones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Reservar</Button>
      <Button variant="secondary">Ver horario</Button>
      <Button variant="danger">Cancelar reserva</Button>
      <Button variant="ghost">Volver</Button>
      <Button disabled>Sin créditos</Button>
      <Button size="sm">Chico</Button>
      <Button size="lg">Grande</Button>
    </div>
  ),
};

export const Formulario: Story = {
  render: () => (
    <form className="flex max-w-md flex-col gap-4">
      <FormField label="Nombre" required>
        <Input placeholder="Micaela" />
      </FormField>

      <FormField label="Documento" description="Sin puntos ni espacios">
        <Input inputMode="numeric" placeholder="40123456" />
      </FormField>

      <FormField label="Documento" error="Ya hay un miembro con ese documento.">
        <Input defaultValue="40123456" />
      </FormField>

      <FormField label="Sede">
        <Select
          placeholder="Elegí una sede"
          options={[
            { value: 'ven_1', label: 'Centro' },
            { value: 'ven_2', label: 'Norte' },
          ]}
        />
      </FormField>

      <FormField label="Nota interna" description="No la ve el miembro">
        <Textarea placeholder="Prefiere el turno de la mañana" />
      </FormField>

      <Checkbox label="Acepto el deslinde de responsabilidad" description="Versión 2 del 01/03" />

      <RadioGroup legend="Política de cancelación">
        <Radio name="policy" label="Hasta 2 horas antes" defaultChecked />
        <Radio name="policy" label="Hasta 12 horas antes" />
        <Radio name="policy" label="Sin cancelación" />
      </RadioGroup>

      <Button type="submit">Guardar</Button>
    </form>
  ),
};

export const Estados: Story = {
  render: () => (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card title="Cargando">
        <Skeleton rows={4} />
      </Card>

      <EmptyState
        title="Todavía no tenés clases"
        description="Creá la primera y empezá a recibir reservas."
        action={<Button>Crear la primera</Button>}
      />

      <ErrorState
        message="La clase está completa."
        action="Podés sumarte a la lista de espera."
        code="LP-BOOK-409-002"
        requestId="01J9X7K2M4N5P6Q7R8S9"
        onRetry={() => undefined}
      />
    </div>
  ),
};

export const Datos: Story = {
  render: function DatosStory() {
    const [tab, setTab] = useState('datos');

    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <Card title="Miembros" actions={<Button size="sm">Agregar</Button>}>
          <Table caption="Miembros del centro">
            <THead>
              <TR>
                <TH>Nombre</TH>
                <TH>Estado</TH>
                <TH>Créditos</TH>
                <TH>Vence</TH>
              </TR>
            </THead>
            <TBody>
              <TR>
                <TD>Micaela Fernández Ortiz</TD>
                <TD>
                  <Badge tone="success">Activa</Badge>
                </TD>
                <TD>3</TD>
                <TD>15/03</TD>
              </TR>
              <TR>
                <TD>Juan Pérez</TD>
                <TD>
                  <Badge tone="danger">En mora</Badge>
                </TD>
                <TD>0</TD>
                <TD>01/03</TD>
              </TR>
              <TR>
                <TD>Lucía Gómez</TD>
                <TD>
                  <Badge tone="warning">Vence pronto</Badge>
                </TD>
                <TD>1</TD>
                <TD>05/03</TD>
              </TR>
            </TBody>
          </Table>
        </Card>

        <Tabs
          label="Ficha del miembro"
          activeId={tab}
          onChange={setTab}
          items={[
            {
              id: 'datos',
              label: 'Datos',
              content: <p className="text-fg-muted">Datos personales</p>,
            },
            {
              id: 'contratos',
              label: 'Contratos',
              content: <p className="text-fg-muted">Pack 8 clases</p>,
            },
            {
              id: 'asistencia',
              label: 'Asistencia',
              content: <p className="text-fg-muted">12 en 90 días</p>,
            },
          ]}
        />
      </div>
    );
  },
};

export const Modal: Story = {
  render: function ModalStory() {
    const [open, setOpen] = useState(false);

    return (
      <div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Cancelar reserva
        </Button>

        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Cancelar la reserva"
          description="Pasó el plazo de cancelación: se descuenta el crédito igual."
          dismissOnBackdrop={false}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Volver
              </Button>
              <Button variant="danger" onClick={() => setOpen(false)}>
                Cancelar igual
              </Button>
            </>
          }
        >
          <p className="text-fg-muted text-sm">Funcional · hoy 19:00 · Sala Principal</p>
        </Dialog>
      </div>
    );
  },
};

export const Avisos: Story = {
  render: function AvisosStory() {
    function Trigger() {
      const { show } = useToast();
      return (
        <div className="flex gap-3">
          <Button onClick={() => show({ message: 'Reserva confirmada', tone: 'success' })}>
            Confirmar
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              show({
                message: 'No te quedan clases en tu pack.',
                tone: 'danger',
                code: 'LP-CTRT-402-001',
                requestId: '01J9X7K2M4N5P6Q7R8S9',
              })
            }
          >
            Provocar error
          </Button>
        </div>
      );
    }

    return (
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
  },
};
