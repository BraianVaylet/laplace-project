import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import type { ClassSession, Room, Venue } from '@laplace/schemas';
import {
  ApiRequestError,
  formatLongDate,
  formatTime,
  useUiStore,
  type ApiClient,
  type VenueTime,
} from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  useToast,
} from '@laplace/ui';
import { api } from './api.js';

/**
 * La agenda del centro (§2.1.5.a, F1-35).
 *
 * 🔴 **Editar pregunta el alcance.** Cambiar "todas las de los lunes" cuando se
 * quería cambiar una sola reescribe la grilla de un mes, y el default es
 * siempre la opción que menos rompe: solo esta.
 *
 * 🔴 **Cancelar dice a cuánta gente afecta, antes de confirmar.** Del otro lado
 * hay socios que se organizaron para venir; el número y el motivo son lo que
 * convierte una cancelación en un aviso y no en una sorpresa.
 */
export interface AgendaProps {
  client?: ApiClient;
}

const DIAS = [
  { weekday: 1, nombre: 'Lunes' },
  { weekday: 2, nombre: 'Martes' },
  { weekday: 3, nombre: 'Miércoles' },
  { weekday: 4, nombre: 'Jueves' },
  { weekday: 5, nombre: 'Viernes' },
  { weekday: 6, nombre: 'Sábado' },
  { weekday: 0, nombre: 'Domingo' },
] as const;

export function Agenda({ client = api }: AgendaProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeVenueId = useUiStore((state) => state.activeVenueId);
  const [semana, setSemana] = useState(0);
  const [publicar, setPublicar] = useState(false);
  const [aEditar, setAEditar] = useState<ClassSession | null>(null);
  const [aCancelar, setACancelar] = useState<ClassSession | null>(null);
  const [alcance, setAlcance] = useState<'solo' | 'futuras'>('solo');

  const sedes = useQuery({
    queryKey: ['venues'],
    queryFn: () => client.get<{ items: Venue[] }>('/venues'),
  });

  const venueId = activeVenueId ?? sedes.data?.items[0]?.publicId ?? null;
  const sede = sedes.data?.items.find((v) => v.publicId === venueId);
  const zona: VenueTime = { timeZone: sede?.timeZone ?? 'America/Argentina/Buenos_Aires' };

  const salas = useQuery({
    queryKey: ['rooms', venueId],
    queryFn: () => client.get<{ items: Room[] }>(`/rooms?venueId=${venueId ?? ''}`),
    enabled: venueId !== null,
  });

  const { desde, hasta } = semanaDe(semana, zona);

  const agenda = useQuery({
    queryKey: ['agenda', venueId, semana],
    queryFn: () =>
      client.get<ClassSession[]>(
        `/sessions?venueId=${venueId ?? ''}&from=${desde.toString()}&to=${hasta.toString()}`,
      ),
    enabled: venueId !== null,
  });

  const refrescar = async () => {
    await queryClient.invalidateQueries({ queryKey: ['agenda'] });
    // El asistente de primeros pasos cuenta plantillas.
    await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
  };

  const crear = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.post('/class-templates', datos),
    onSuccess: async () => {
      setPublicar(false);
      toast.show({ tone: 'success', message: 'Publicamos la clase.' });
      await refrescar();
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const editar = useMutation({
    mutationFn: ({ clase, capacity }: { clase: ClassSession; capacity: number }) =>
      /*
       * 🔴 El alcance viaja en la URL de la plantilla, no como un campo del
       * cuerpo: la API lo lee de `?scope=` y sin él **no propaga**, que es el
       * default que menos rompe.
       */
      alcance === 'futuras' && clase.templateId
        ? client.patch(`/class-templates/${clase.templateId}?scope=this_and_future`, { capacity })
        : client.patch(`/sessions/${clase.publicId}`, { capacity }),
    onSuccess: async () => {
      setAEditar(null);
      toast.show({ tone: 'success', message: 'Guardamos el cambio.' });
      await refrescar();
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const cancelar = useMutation({
    mutationFn: ({ clase, reason }: { clase: ClassSession; reason: string }) =>
      client.post(`/sessions/${clase.publicId}/cancel`, { reason }),
    onSuccess: async () => {
      setACancelar(null);
      toast.show({ tone: 'success', message: 'Cancelamos la clase y avisamos a los inscriptos.' });
      await refrescar();
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  if (!venueId) {
    return (
      <EmptyState
        title="Elegí un centro"
        description="La agenda es de una sede a la vez."
        action={<Button disabled>Sin centro activo</Button>}
      />
    );
  }

  if (agenda.isPending) return <Skeleton className="h-64" label="Cargando la agenda" />;

  if (agenda.isError) {
    return (
      <ErrorState
        title="No pudimos traer la agenda"
        message={mensajeDe(agenda.error)}
        onRetry={() => void agenda.refetch()}
        {...accionDe(agenda.error)}
      />
    );
  }

  const ahora = Temporal.Now.instant();
  const yaPaso = (clase: ClassSession) =>
    Temporal.Instant.compare(Temporal.Instant.from(clase.startAt), ahora) < 0;

  const porDia = DIAS.map(({ weekday, nombre }) => ({
    weekday,
    nombre,
    clases: agenda.data
      .filter(
        (clase) =>
          Temporal.Instant.from(clase.startAt).toZonedDateTimeISO(zona.timeZone).dayOfWeek % 7 ===
          weekday,
      )
      .sort((a, b) => a.startAt.localeCompare(b.startAt)),
  })).filter((dia) => dia.clases.length > 0);

  const publicarClase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const byWeekday = datos.getAll('weekday').map(Number);

    crear.mutate({
      venueId,
      roomId: String(datos.get('roomId') ?? ''),
      name: String(datos.get('name') ?? '').trim(),
      categoryId: String(datos.get('categoryId') ?? '').trim(),
      durationMin: Number(datos.get('durationMin') ?? 60),
      ...(datos.get('capacity') ? { capacity: Number(datos.get('capacity')) } : {}),
      recurrence: {
        freq: 'weekly',
        byWeekday,
        timeOfDay: String(datos.get('timeOfDay') ?? '19:00'),
        interval: 1,
        from: Temporal.Now.plainDateISO(zona.timeZone).toString(),
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <h1 className="text-fg text-xl font-semibold">Agenda</h1>
          <p className="text-fg-muted text-sm">
            {formatLongDate(desde, zona)} — {formatLongDate(hasta.subtract({ hours: 1 }), zona)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="h-11" onClick={() => setSemana(semana - 1)}>
            Semana anterior
          </Button>
          <Button variant="secondary" className="h-11" onClick={() => setSemana(semana + 1)}>
            Semana siguiente
          </Button>
          {agenda.data.length > 0 ? (
            <Button onClick={() => setPublicar(true)}>Publicar una clase</Button>
          ) : null}
        </div>
      </header>

      {agenda.data.length === 0 ? (
        <EmptyState
          title="No hay clases esta semana"
          description="Una plantilla define el día, la hora y el cupo, y la grilla se publica sola."
          action={<Button onClick={() => setPublicar(true)}>Publicar una clase</Button>}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {porDia.map((dia) => (
            <Card key={dia.weekday} title={dia.nombre}>
              <ul className="flex flex-col gap-3">
                {dia.clases.map((clase) => (
                  <li
                    key={clase.publicId}
                    className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 first:border-t-0 first:pt-0"
                  >
                    <span className="text-fg min-w-14 text-sm font-medium">
                      {formatTime(Temporal.Instant.from(clase.startAt), zona)}
                    </span>
                    <span className="text-fg flex-1 text-sm font-medium">{clase.name}</span>
                    <span className="text-fg-muted text-sm">
                      {salaDe(clase, salas.data?.items)}
                    </span>
                    <span className="text-fg-muted text-sm">
                      {clase.bookedCount} de {clase.capacity}
                    </span>
                    {clase.waitlistCount > 0 ? (
                      <Badge tone="warning">{clase.waitlistCount} en espera</Badge>
                    ) : null}
                    {clase.status === 'cancelled' ? <Badge tone="danger">Cancelada</Badge> : null}

                    {/* Lo que ya pasó no se toca: es el registro de lo que ocurrió. */}
                    {yaPaso(clase) || clase.status === 'cancelled' ? null : (
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => {
                            setAlcance('solo');
                            setAEditar(clase);
                          }}
                        >
                          <span aria-hidden="true">Editar</span>
                          <span className="sr-only">Editar {clase.name}</span>
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-11"
                          onClick={() => setACancelar(clase)}
                        >
                          <span aria-hidden="true">Cancelar</span>
                          <span className="sr-only">Cancelar {clase.name}</span>
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {publicar ? (
        <Dialog
          open={publicar}
          onClose={() => setPublicar(false)}
          title="Publicar una clase"
          description="Se define una vez y la grilla de los próximos 60 días se arma sola."
        >
          <form onSubmit={publicarClase} className="flex flex-col gap-4">
            <FormField label="Nombre de la clase" required>
              <Input name="name" required minLength={2} maxLength={80} />
            </FormField>

            <FormField
              label="Categoría"
              required
              description="Es lo que después habilita o bloquea un pack."
            >
              <Input name="categoryId" required maxLength={40} />
            </FormField>

            <FormField label="Sala" required>
              <Select
                name="roomId"
                required
                options={(salas.data?.items ?? []).map((sala) => ({
                  value: sala.publicId,
                  label: `${sala.name} (${sala.capacity})`,
                }))}
              />
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-fg text-sm font-medium">Días</legend>
              {DIAS.map(({ weekday, nombre }) => (
                <Checkbox key={weekday} name="weekday" value={String(weekday)} label={nombre} />
              ))}
            </fieldset>

            <FormField label="Hora" required description="Hora local del centro.">
              <Input name="timeOfDay" type="time" defaultValue="19:00" required />
            </FormField>

            <FormField label="Duración" required description="En minutos.">
              <Input
                name="durationMin"
                type="number"
                min={5}
                max={480}
                defaultValue={60}
                required
              />
            </FormField>

            <FormField label="Cupo" description="Sin valor, hereda el de la sala.">
              <Input name="capacity" type="number" min={1} max={500} />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={crear.isPending}>
                Publicar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPublicar(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {aEditar ? (
        <Dialog
          open={aEditar !== null}
          onClose={() => setAEditar(null)}
          title={aEditar ? `Editar ${aEditar.name}` : 'Editar'}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const capacity = Number(new FormData(event.currentTarget).get('capacity'));
              if (aEditar) editar.mutate({ clase: aEditar, capacity });
            }}
            className="flex flex-col gap-4"
          >
            {/*
            El alcance se pregunta y "solo esta" viene elegida: propagar por
            default reescribiría clases ya publicadas sin que nadie lo pidiera.
          */}
            {aEditar?.templateId ? (
              <RadioGroup legend="Qué querés cambiar">
                <Radio
                  name="alcance"
                  label="Solo esta clase"
                  checked={alcance === 'solo'}
                  onChange={() => setAlcance('solo')}
                />
                <Radio
                  name="alcance"
                  label="Esta y las que siguen"
                  description="Cambia la plantilla. Las clases que ya pasaron no se tocan."
                  checked={alcance === 'futuras'}
                  onChange={() => setAlcance('futuras')}
                />
              </RadioGroup>
            ) : (
              <p className="text-fg-muted text-sm">
                Es una clase suelta: no viene de una plantilla.
              </p>
            )}

            <FormField label="Cupo" required>
              <Input
                name="capacity"
                type="number"
                min={1}
                max={500}
                defaultValue={aEditar?.capacity ?? 16}
                required
              />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={editar.isPending}>
                Guardar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAEditar(null)}>
                Volver
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {aCancelar ? (
        <Dialog
          open={aCancelar !== null}
          onClose={() => setACancelar(null)}
          title={aCancelar ? `Cancelar ${aCancelar.name}` : 'Cancelar'}
          dismissOnBackdrop={false}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
              if (aCancelar) cancelar.mutate({ clase: aCancelar, reason });
            }}
            className="flex flex-col gap-4"
          >
            {/* 🔴 El número va antes del botón: del otro lado hay gente que se
              organizó para venir. */}
            <p className="text-fg text-sm">
              Se cancelan {aCancelar?.bookedCount ?? 0} reservas y se les devuelve el crédito a
              todos. Les llega un aviso con el motivo.
            </p>

            <FormField
              label="Motivo"
              required
              description="Lo lee el socio en el aviso: 'se canceló' y nada más no le sirve a nadie."
            >
              <Input name="reason" required minLength={5} maxLength={300} />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={cancelar.isPending}>
                Cancelar la clase
              </Button>
              <Button type="button" variant="secondary" onClick={() => setACancelar(null)}>
                No, volver
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

/** La semana que se está mirando, en la zona del centro. */
function semanaDe(offset: number, zona: VenueTime) {
  const hoy = Temporal.Now.zonedDateTimeISO(zona.timeZone).startOfDay();
  const lunes = hoy.subtract({ days: (hoy.dayOfWeek - 1) % 7 }).add({ weeks: offset });

  return { desde: lunes.toInstant(), hasta: lunes.add({ days: 7 }).toInstant() };
}

const salaDe = (clase: ClassSession, salas: Room[] | undefined) =>
  salas?.find((sala) => sala.publicId === clase.roomId)?.name ?? 'Sala';

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
