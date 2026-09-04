import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import type {
  Booking,
  BookingPolicyView,
  BookingResult,
  ClassSession,
  Venue,
} from '@laplace/schemas';
import { ApiRequestError, useUiStore, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@laplace/ui';
import { api } from './api.js';

/**
 * El horario del centro y la reserva (§2.1.5, §5.1.3).
 *
 * Es la pantalla que el socio abre todos los días, muchas veces en el colectivo
 * y con una barra de señal. De ahí salen las tres decisiones de acá:
 *
 * 1. **La reserva es optimista.** El botón responde al instante y, si la API
 *    dice que no, se revierte con el mensaje del error tipado. Esperar dos
 *    segundos mirando un spinner para enterarse de que la clase estaba llena es
 *    peor que enterarse un segundo después de haber creído que entrabas.
 * 2. **La política se muestra ANTES de confirmar** (§2.1.5.d): hasta cuándo se
 *    puede cancelar y qué pasa si cancela tarde. Descubrirlo cuando ya perdió
 *    el crédito es la queja número uno de este tipo de producto.
 * 3. **El horario se ve sin red**: queda cacheado, porque el subte no tiene
 *    señal y el horario de mañana no cambió (§5.1.3).
 */
export interface ScheduleProps {
  client?: ApiClient;
}

/** Cuántos días muestra la pantalla. Una semana es lo que se planifica. */
const DIAS_VISIBLES = 7;

export function Schedule({ client = api }: ScheduleProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeVenueId = useUiStore((state) => state.activeVenueId);
  const setActiveVenueId = useUiStore((state) => state.setActiveVenueId);
  const [aConfirmar, setAConfirmar] = useState<ClassSession | null>(null);
  const [aCancelar, setACancelar] = useState<Booking | null>(null);

  const sedes = useQuery({
    queryKey: ['venues'],
    queryFn: () => client.get<{ items: Venue[] }>('/venues'),
  });

  const venueId = activeVenueId ?? sedes.data?.items[0]?.publicId ?? null;

  const horario = useQuery({
    queryKey: ['sessions', venueId],
    queryFn: () => {
      const desde = Temporal.Now.instant();
      const hasta = desde.add({ hours: 24 * DIAS_VISIBLES });

      return client.get<ClassSession[]>(
        `/sessions?venueId=${venueId ?? ''}&from=${desde.toString()}&to=${hasta.toString()}`,
      );
    },
    enabled: venueId !== null,
    /*
     * Se muestra lo cacheado mientras se refresca: al abrir en el colectivo, el
     * horario aparece de una y se actualiza solo si hay señal (§5.1.3).
     */
    staleTime: 60_000,
  });

  const misReservas = useQuery({
    queryKey: ['bookings', 'mias'],
    queryFn: () => client.get<{ items: Booking[] }>('/bookings'),
  });

  const reservaPorClase = new Map(
    (misReservas.data?.items ?? [])
      .filter((reserva) => reserva.status === 'booked' || reserva.status === 'waitlisted')
      .map((reserva) => [reserva.sessionId, reserva]),
  );

  const refrescar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sessions', venueId] }),
      queryClient.invalidateQueries({ queryKey: ['bookings', 'mias'] }),
    ]);
  };

  /**
   * 🔴 La reserva optimista: el cupo baja en pantalla antes de que la API
   * conteste, y si contesta que no, vuelve a donde estaba.
   */
  const reservar = useMutation({
    mutationFn: (sessionId: string) =>
      client.post<BookingResult>(
        '/bookings',
        { sessionId },
        // §5.0: sin clave de idempotencia, el socio que toca dos veces gasta
        // dos créditos.
        { idempotencyKey: `wafm-${sessionId}-${Date.now()}` },
      ),
    onMutate: async (sessionId) => {
      await queryClient.cancelQueries({ queryKey: ['sessions', venueId] });
      const anterior = queryClient.getQueryData<ClassSession[]>(['sessions', venueId]);

      queryClient.setQueryData<ClassSession[]>(['sessions', venueId], (clases) =>
        (clases ?? []).map((clase) =>
          clase.publicId === sessionId ? { ...clase, bookedCount: clase.bookedCount + 1 } : clase,
        ),
      );

      return { anterior };
    },
    onError: (error: unknown, _sessionId, context) => {
      // El rollback: vuelve exactamente al estado de antes de tocar.
      queryClient.setQueryData(['sessions', venueId], context?.anterior);
      toast.show({ tone: 'danger', message: mensajeDe(error), ...accionDe(error) });
    },
    onSuccess: (resultado) => {
      toast.show({
        tone: 'success',
        message:
          resultado.booking.status === 'waitlisted'
            ? `Quedaste en la lista de espera, puesto ${resultado.booking.waitlistPosition ?? 1}.`
            : 'Listo, quedaste anotado.',
      });
    },
    onSettled: refrescar,
  });

  const cancelar = useMutation({
    mutationFn: (bookingId: string) =>
      client.post(`/bookings/${bookingId}/cancel`, { acceptsLateCancel: true }),
    onError: (error: unknown) =>
      toast.show({ tone: 'danger', message: mensajeDe(error), ...accionDe(error) }),
    onSuccess: () => toast.show({ tone: 'success', message: 'Cancelaste tu lugar.' }),
    onSettled: refrescar,
  });

  if (horario.isPending || sedes.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando el horario">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (horario.isError) {
    return (
      <ErrorState
        title="No pudimos traer el horario"
        message={mensajeDe(horario.error)}
        onRetry={() => void horario.refetch()}
        {...accionDe(horario.error)}
      />
    );
  }

  const clases = [...horario.data].sort((una, otra) => una.startAt.localeCompare(otra.startAt));
  const porDia = agruparPorDia(clases);
  const sedesDisponibles = sedes.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-fg text-xl font-semibold">Horario</h1>

        {/* El selector aparece solo con más de una sede: con una es ruido. */}
        {sedesDisponibles.length > 1 && (
          <label className="text-sm">
            <span className="text-fg-muted block">Centro</span>
            <select
              value={venueId ?? ''}
              onChange={(event) => setActiveVenueId(event.currentTarget.value)}
              className="bg-surface-2 border-border text-fg focus-visible:focus-ring mt-1 h-11 w-full rounded-md border px-3"
            >
              {sedesDisponibles.map((sede) => (
                <option key={sede.publicId} value={sede.publicId}>
                  {sede.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      {clases.length === 0 ? (
        <EmptyState
          title="No hay clases publicadas"
          description="Cuando el centro publique el horario de la semana, lo vas a ver acá."
          action={<Button disabled>Sin clases</Button>}
        />
      ) : (
        porDia.map(([dia, delDia]) => (
          <section key={dia} className="flex flex-col gap-2">
            <h2 className="text-fg text-lg font-semibold">{dia}</h2>
            <ul className="flex flex-col gap-2">
              {delDia.map((clase) => (
                <li key={clase.publicId}>
                  <ClassRow
                    session={clase}
                    booking={reservaPorClase.get(clase.publicId)}
                    onBook={() => setAConfirmar(clase)}
                    onCancel={(reserva) => setACancelar(reserva)}
                    disabled={reservar.isPending || cancelar.isPending}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {aConfirmar ? (
        <ConfirmBooking
          client={client}
          session={aConfirmar}
          onClose={() => setAConfirmar(null)}
          onConfirm={() => {
            reservar.mutate(aConfirmar.publicId);
            setAConfirmar(null);
          }}
        />
      ) : null}

      {aCancelar ? (
        <ConfirmCancel
          client={client}
          booking={aCancelar}
          onClose={() => setACancelar(null)}
          onConfirm={() => {
            cancelar.mutate(aCancelar.publicId);
            setACancelar(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** Una clase del horario: hora, nombre, cupo y qué puede hacer el socio. */
function ClassRow({
  session,
  booking,
  onBook,
  onCancel,
  disabled,
}: {
  session: ClassSession;
  booking: Booking | undefined;
  onBook: () => void;
  onCancel: (booking: Booking) => void;
  disabled: boolean;
}) {
  const libres = Math.max(session.capacity - session.bookedCount, 0);
  const completa = libres === 0;

  return (
    <Card
      title={`${horaDe(session.startAt)} · ${session.name}`}
      actions={
        booking ? (
          <Badge tone={booking.status === 'waitlisted' ? 'warning' : 'success'}>
            {booking.status === 'waitlisted'
              ? `En espera · ${booking.waitlistPosition ?? 1}`
              : 'Reservado'}
          </Badge>
        ) : (
          <Badge tone={completa ? 'neutral' : 'brand'}>
            {completa ? 'Completa' : `${libres} ${libres === 1 ? 'lugar' : 'lugares'}`}
          </Badge>
        )
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-fg-muted text-sm">
          {session.bookedCount} de {session.capacity}
          {completa && session.waitlistCount > 0 ? ` · ${session.waitlistCount} en espera` : ''}
        </p>

        {booking ? (
          <Button
            variant="secondary"
            className="h-11"
            disabled={disabled}
            onClick={() => onCancel(booking)}
          >
            Cancelar
          </Button>
        ) : (
          <Button className="h-11" disabled={disabled} onClick={onBook}>
            {completa ? 'Anotarme en la espera' : 'Reservar'}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * 🔴 El modal que muestra la política **antes** de confirmar (§2.1.5.d).
 *
 * Es el momento en que el socio acepta las reglas: hasta cuándo puede cancelar
 * y qué pasa si cancela tarde. Descubrirlo después de perder el crédito es la
 * queja número uno de este tipo de producto.
 */
function ConfirmBooking({
  client,
  session,
  onClose,
  onConfirm,
}: {
  client: ApiClient;
  session: ClassSession;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const politica = useQuery({
    queryKey: ['booking-policy', session.publicId],
    queryFn: () => client.get<BookingPolicyView>(`/booking-policies/${session.publicId}`),
  });

  const completa = session.bookedCount >= session.capacity;

  return (
    <Dialog
      open
      onClose={onClose}
      title={completa ? 'Anotarte en la lista de espera' : 'Confirmar tu reserva'}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button onClick={onConfirm}>
            {completa ? 'Confirmar la espera' : 'Confirmar reserva'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg">
          {session.name}, {horaDe(session.startAt)}.
        </p>

        {politica.isPending ? (
          <Skeleton className="h-12" aria-label="Cargando la política de cancelación" />
        ) : politica.isError ? (
          <p className="text-fg-muted text-sm">
            No pudimos traer la política de cancelación. Podés reservar igual y consultarla en el
            centro.
          </p>
        ) : (
          <p className="text-fg-muted text-sm">{politica.data.text}</p>
        )}

        {completa ? (
          <p className="text-fg-muted text-sm">
            La clase está llena. Si alguien cancela, te avisamos y tenés un rato para confirmar.
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Cancelar. 🔴 Le dice **antes de confirmar** si recupera el crédito o no: es
 * la diferencia entre una decisión y una sorpresa.
 */
function ConfirmCancel({
  client,
  booking,
  onClose,
  onConfirm,
}: {
  client: ApiClient;
  booking: Booking;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const politica = useQuery({
    queryKey: ['booking-policy', booking.sessionId],
    queryFn: () => client.get<BookingPolicyView>(`/booking-policies/${booking.sessionId}`),
  });

  const tarde =
    politica.data !== undefined &&
    Temporal.Instant.compare(
      Temporal.Now.instant(),
      Temporal.Instant.from(politica.data.cancelCutoffAt),
    ) > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Cancelar tu lugar"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button onClick={onConfirm}>Cancelar mi lugar</Button>
        </div>
      }
    >
      {politica.isPending ? (
        <Skeleton className="h-12" aria-label="Cargando la política de cancelación" />
      ) : (
        <p className="text-fg-muted text-sm">
          {tarde
            ? 'Estás cancelando fuera de plazo: según la política del centro, podés perder el crédito de esta clase.'
            : 'Estás en plazo: recuperás el crédito de esta clase.'}
        </p>
      )}
    </Dialog>
  );
}

/** Agrupa por día del centro, en el orden en que se leen. */
function agruparPorDia(clases: readonly ClassSession[]): Array<[string, ClassSession[]]> {
  const porDia = new Map<string, ClassSession[]>();

  for (const clase of clases) {
    const dia = diaDe(clase.startAt);
    porDia.set(dia, [...(porDia.get(dia) ?? []), clase]);
  }

  return [...porDia.entries()];
}

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/**
 * "lunes 9 de marzo", en la zona del navegador.
 *
 * A mano y no con `Intl`: el formato de es-AR cambia entre versiones del
 * navegador, y el encabezado de un día no puede depender de eso.
 */
function diaDe(instante: string): string {
  const local = Temporal.Instant.from(instante).toZonedDateTimeISO(zonaDelSocio());

  return `${DIAS[local.dayOfWeek - 1] as string} ${local.day} de ${MESES[local.month - 1] as string}`;
}

function horaDe(instante: string): string {
  return Temporal.Instant.from(instante)
    .toZonedDateTimeISO(zonaDelSocio())
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });
}

/**
 * La zona del socio. Es la del navegador porque es la que tiene el teléfono en
 * la mano: si viaja, ve la hora del lugar donde está, que es lo que espera.
 */
function zonaDelSocio(): string {
  return Temporal.Now.timeZoneId();
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
