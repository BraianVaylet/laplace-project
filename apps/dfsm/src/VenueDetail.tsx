import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Room, Venue } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  ErrorState,
  FormField,
  Input,
  Select,
  Skeleton,
  useToast,
} from '@laplace/ui';
import { api } from './api.js';

/**
 * La configuración de una sede (§2.1.4, §2.1.5.c — F1-33).
 *
 * Tres cosas: sus horarios, su política de reserva y sus salas.
 *
 * 🔴 **Cada regla dice qué pasa si no se toca.** La política son siete números
 * en minutos; sin el default explicado al lado, el SMU los deja como están sin
 * saber qué eligió, y después descubre la regla el día que un socio reclama.
 */
export interface VenueDetailProps {
  venueId: string;
  client?: ApiClient;
}

const DIAS = [
  { weekday: 0, nombre: 'domingo' },
  { weekday: 1, nombre: 'lunes' },
  { weekday: 2, nombre: 'martes' },
  { weekday: 3, nombre: 'miércoles' },
  { weekday: 4, nombre: 'jueves' },
  { weekday: 5, nombre: 'viernes' },
  { weekday: 6, nombre: 'sábado' },
] as const;

export function VenueDetail({ venueId, client = api }: VenueDetailProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [salaAbierta, setSalaAbierta] = useState(false);
  const [archivarAbierto, setArchivarAbierto] = useState(false);

  const sede = useQuery({
    queryKey: ['venue', venueId],
    queryFn: () => client.get<Venue>(`/venues/${venueId}`),
  });

  const salas = useQuery({
    queryKey: ['rooms', venueId],
    queryFn: () => client.get<{ items: Room[] }>(`/rooms?venueId=${venueId}`),
  });

  const guardar = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.patch(`/venues/${venueId}`, datos),
    onSuccess: async () => {
      toast.show({ tone: 'success', message: 'Guardamos los cambios.' });
      await queryClient.invalidateQueries({ queryKey: ['venue', venueId] });
      await queryClient.invalidateQueries({ queryKey: ['venues'] });
      // El asistente cuenta sedes con horario: que se entere ya.
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const crearSala = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.post('/rooms', datos),
    onSuccess: async () => {
      setSalaAbierta(false);
      toast.show({ tone: 'success', message: 'Agregamos la sala.' });
      await queryClient.invalidateQueries({ queryKey: ['rooms', venueId] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const archivar = useMutation({
    mutationFn: () => client.post(`/venues/${venueId}/archive`, {}),
    onSuccess: async () => {
      setArchivarAbierto(false);
      toast.show({ tone: 'success', message: 'Archivamos la sede.' });
      await queryClient.invalidateQueries({ queryKey: ['venue', venueId] });
      await queryClient.invalidateQueries({ queryKey: ['venues'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  if (sede.isPending) return <Skeleton className="h-64" label="Cargando la sede" />;

  if (sede.isError) {
    return (
      <ErrorState
        title="No pudimos traer la sede"
        message={mensajeDe(sede.error)}
        onRetry={() => void sede.refetch()}
        {...accionDe(sede.error)}
      />
    );
  }

  const horarioDe = (weekday: number) =>
    sede.data.businessHours.find((dia) => dia.weekday === weekday);

  const guardarHorarios = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    /*
     * 🔴 Un día con el horario en blanco **no abre**. No es "abre a las 00:00":
     * mandar un rango vacío como si fuera un horario dejaría publicar clases un
     * día que el centro está cerrado.
     */
    const businessHours = DIAS.flatMap(({ weekday }) => {
      const opensAt = datos[`abre-${weekday}`];
      const closesAt = datos[`cierra-${weekday}`];

      return opensAt && closesAt ? [{ weekday, opensAt, closesAt }] : [];
    });

    guardar.mutate({ businessHours });
  };

  const guardarPolitica = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const minutos = (campo: string) => Number(datos.get(campo));

    guardar.mutate({
      bookingPolicy: {
        ...sede.data.bookingPolicy,
        bookingOpensMinutesBefore: minutos('bookingOpensMinutesBefore'),
        bookingClosesMinutesBefore: minutos('bookingClosesMinutesBefore'),
        cancelCutoffMinutes: minutos('cancelCutoffMinutes'),
        checkInOpensMinutesBefore: minutos('checkInOpensMinutesBefore'),
        checkInClosesMinutesAfter: minutos('checkInClosesMinutesAfter'),
        lateCancelPolicy: String(datos.get('lateCancelPolicy')),
        allowDebt: datos.get('allowDebt') === 'on',
      },
    });
  };

  const agregarSala = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    crearSala.mutate({
      venueId,
      name: datos['name'],
      capacity: Number(datos['capacity']),
      equipment: [],
    });
  };

  const politica = sede.data.bookingPolicy as Record<string, unknown>;
  const valor = (campo: string, porDefecto: number) => Number(politica[campo] ?? porDefecto);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-fg text-xl font-semibold">{sede.data.name}</h1>
        <p className="text-fg-muted text-sm">
          {sede.data.address} · {sede.data.timeZone}
        </p>
      </header>

      <Card title="Horarios">
        <form onSubmit={guardarHorarios} className="flex flex-col gap-4">
          <p className="text-fg-muted text-sm">
            El día que dejes en blanco es un día que el centro no abre.
          </p>

          <div className="flex flex-col gap-3">
            {DIAS.map(({ weekday, nombre }) => (
              <div key={weekday} className="flex flex-wrap items-end gap-3">
                <span className="text-fg min-w-24 text-sm font-medium capitalize">{nombre}</span>

                <label className="flex flex-col gap-1">
                  <span className="text-fg-muted text-xs">Abre</span>
                  <Input
                    type="time"
                    name={`abre-${weekday}`}
                    aria-label={`Abre el ${nombre}`}
                    defaultValue={horarioDe(weekday)?.opensAt ?? ''}
                    className="w-32"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-fg-muted text-xs">Cierra</span>
                  <Input
                    type="time"
                    name={`cierra-${weekday}`}
                    aria-label={`Cierra el ${nombre}`}
                    defaultValue={horarioDe(weekday)?.closesAt ?? ''}
                    className="w-32"
                  />
                </label>
              </div>
            ))}
          </div>

          <div>
            <Button type="submit" disabled={guardar.isPending}>
              Guardar horarios
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Política de reserva">
        <form onSubmit={guardarPolitica} className="flex flex-col gap-4">
          <FormField
            label="Cuándo se abre la reserva"
            description="Por defecto: 7 días antes de la clase."
          >
            <Select
              name="bookingOpensMinutesBefore"
              options={ANTICIPACION}
              defaultValue={String(valor('bookingOpensMinutesBefore', 10_080))}
            />
          </FormField>

          <FormField
            label="Cuándo se cierra la reserva"
            description="Por defecto: 15 minutos antes de empezar."
          >
            <Select
              name="bookingClosesMinutesBefore"
              options={CIERRE}
              defaultValue={String(valor('bookingClosesMinutesBefore', 15))}
            />
          </FormField>

          <FormField
            label="Hasta cuándo se puede cancelar"
            description="Sin perder el crédito. Por defecto: 2 horas antes."
          >
            <Select
              name="cancelCutoffMinutes"
              options={CANCELACION}
              defaultValue={String(valor('cancelCutoffMinutes', 120))}
            />
          </FormField>

          <FormField
            label="Si cancela tarde"
            description="Es la regla que más se reclama. Por defecto: el crédito no se devuelve, porque el lugar ya no se puede revender."
          >
            <Select
              name="lateCancelPolicy"
              options={LATE_CANCEL}
              defaultValue={String(politica['lateCancelPolicy'] ?? 'no_refund')}
            />
          </FormField>

          <FormField
            label="Cuándo abre el check-in"
            description="Por defecto: 30 minutos antes de la clase."
          >
            <Select
              name="checkInOpensMinutesBefore"
              options={CHECK_IN_ANTES}
              defaultValue={String(valor('checkInOpensMinutesBefore', 30))}
            />
          </FormField>

          <FormField
            label="Hasta cuándo se puede entrar"
            description="Después de esto, quien no marcó queda ausente. Por defecto: 30 minutos después de empezar."
          >
            <Select
              name="checkInClosesMinutesAfter"
              options={CHECK_IN_DESPUES}
              defaultValue={String(valor('checkInClosesMinutesAfter', 30))}
            />
          </FormField>

          <Checkbox
            name="allowDebt"
            label="Dejar reservar a quien debe"
            description="Por defecto está apagado: quien debe no toma un lugar hasta ponerse al día."
            defaultChecked={politica['allowDebt'] === true}
          />

          <div>
            <Button type="submit" disabled={guardar.isPending}>
              Guardar política
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Salas">
        <div className="flex flex-col gap-3">
          {salas.isPending ? (
            <Skeleton className="h-16" label="Cargando las salas" />
          ) : salas.isError ? (
            <ErrorState
              title="No pudimos traer las salas"
              message={mensajeDe(salas.error)}
              onRetry={() => void salas.refetch()}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {(salas.data?.items ?? []).map((sala) => (
                <li key={sala.publicId} className="flex flex-wrap items-center gap-3">
                  <span className="text-fg text-sm font-medium">{sala.name}</span>
                  <span className="text-fg-muted text-sm">{sala.capacity} personas</span>
                  {sala.status === 'active' ? null : <Badge tone="neutral">Archivada</Badge>}
                </li>
              ))}
            </ul>
          )}

          <div>
            <Button variant="secondary" className="h-11" onClick={() => setSalaAbierta(true)}>
              Agregar sala
            </Button>
          </div>
        </div>
      </Card>

      {sede.data.status === 'active' ? (
        <Card title="Archivar">
          <div className="flex flex-col gap-3">
            <p className="text-fg-muted text-sm">
              La sede deja de ofrecerse y libera el cupo del plan. Lo que ya ocurrió queda: las
              clases pasadas y los cobros son el registro de lo que de verdad pasó.
            </p>
            <div>
              <Button variant="danger" onClick={() => setArchivarAbierto(true)}>
                Archivar la sede
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Dialog
        open={archivarAbierto}
        onClose={() => setArchivarAbierto(false)}
        title={`Archivar ${sede.data.name}`}
        description="Deja de ofrecerse para clases nuevas y libera el cupo del plan. Lo que ya ocurrió queda."
        dismissOnBackdrop={false}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={archivar.isPending}
              onClick={() => archivar.mutate()}
            >
              Archivar
            </Button>
            <Button variant="secondary" onClick={() => setArchivarAbierto(false)}>
              No, volver
            </Button>
          </div>
        }
      >
        <p className="text-fg-muted text-sm">
          Si la sede tiene clases futuras publicadas, la API lo va a rechazar: primero hay que
          cancelarlas, y eso avisa a los inscriptos y les devuelve el crédito.
        </p>
      </Dialog>

      <Dialog
        open={salaAbierta}
        onClose={() => setSalaAbierta(false)}
        title="Agregar una sala"
        description="La capacidad de la sala es la que hereda cada clase."
      >
        <form onSubmit={agregarSala} className="flex flex-col gap-4">
          <FormField label="Nombre de la sala" required>
            <Input name="name" required minLength={2} maxLength={60} autoFocus />
          </FormField>

          <FormField label="Capacidad" required description="En personas.">
            <Input name="capacity" type="number" min={1} max={500} defaultValue={20} required />
          </FormField>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={crearSala.isPending}>
              Agregar
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSalaAbierta(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/*
 * Las ventanas se guardan en minutos porque así las entiende la API, pero nadie
 * piensa "10080 minutos": las opciones son las que un centro elige de verdad.
 */
const ANTICIPACION = [
  { value: '1440', label: '1 día antes' },
  { value: '4320', label: '3 días antes' },
  { value: '10080', label: '7 días antes' },
  { value: '20160', label: '14 días antes' },
  { value: '43200', label: '30 días antes' },
];

const CIERRE = [
  { value: '0', label: 'Al empezar la clase' },
  { value: '15', label: '15 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
  { value: '120', label: '2 horas antes' },
];

const CANCELACION = [
  { value: '60', label: '1 hora antes' },
  { value: '120', label: '2 horas antes' },
  { value: '240', label: '4 horas antes' },
  { value: '720', label: '12 horas antes' },
  { value: '1440', label: '24 horas antes' },
];

const CHECK_IN_ANTES = [
  { value: '15', label: '15 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
  { value: '120', label: '2 horas antes' },
];

const CHECK_IN_DESPUES = [
  { value: '0', label: 'Al empezar' },
  { value: '15', label: '15 minutos después' },
  { value: '30', label: '30 minutos después' },
  { value: '60', label: '1 hora después' },
];

const LATE_CANCEL = [
  { value: 'no_refund', label: 'Pierde el crédito' },
  { value: 'refund', label: 'Se le devuelve igual' },
  { value: 'refund_and_notify', label: 'Se le devuelve y queda constancia' },
];

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
