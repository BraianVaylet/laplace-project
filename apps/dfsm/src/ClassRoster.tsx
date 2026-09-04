import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import type { BulkCheckInResult, ClassRoster as ClassRosterData } from '@laplace/schemas';
import { ApiRequestError, formatTime, type ApiClient } from '@laplace/client';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast } from '@laplace/ui';
import { api } from './api.js';

/**
 * La lista de clase del coach (§2.1.18, §5.1.2).
 *
 * Es la pantalla que se usa **de pie, con una mano**, en el piso del box: una
 * sola columna, nombres grandes y cada acción con su propio botón de 44 px. Si
 * hay que apuntar con precisión, no se usa.
 *
 * Todo llega resuelto en una sola llamada. Encadenar pedidos para armar la
 * pantalla sería hacer esperar al coach tres veces con el gimnasio lleno.
 */
export interface ClassRosterProps {
  sessionId: string;
  /**
   * El cliente de API. Se inyecta para poder probar la pantalla sin red: el
   * singleton de `api.ts` captura el `fetch` del entorno al crearse, así que
   * sustituirlo después no alcanzaría.
   */
  client?: ApiClient;
}

export function ClassRoster({ sessionId, client = api }: ClassRosterProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const roster = useQuery({
    queryKey: ['roster', sessionId],
    queryFn: () => client.get<ClassRosterData>(`/sessions/${sessionId}/roster`),
  });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['roster', sessionId] });
  const avisarDelError = (error: unknown) =>
    toast.show({ tone: 'danger', message: mensajeDe(error), ...codigoDe(error) });

  const marcar = useMutation({
    mutationFn: (bookingId: string) =>
      // §5.0: el check-in exige clave de idempotencia. El coach toca dos veces
      // cuando la lista tarda, y sin la clave eso serían dos ingresos.
      client.post(
        `/bookings/${bookingId}/check-in`,
        { method: 'staff' },
        { idempotencyKey: nuevaClave() },
      ),
    onSuccess: refrescar,
    onError: avisarDelError,
  });

  const marcarTodos = useMutation({
    mutationFn: () =>
      client.post<BulkCheckInResult>(
        `/sessions/${sessionId}/check-in-all`,
        {},
        { idempotencyKey: nuevaClave() },
      ),
    onSuccess: async (resultado) => {
      await refrescar();
      const quedaron = resultado.skipped.length;

      toast.show({
        tone: quedaron > 0 ? 'info' : 'success',
        // Los que quedaron afuera se dicen: enterarse cuando el socio reclama es
        // peor que un aviso de más.
        message:
          quedaron > 0
            ? `${resultado.checkedIn} presentes. ${quedaron} quedaron sin marcar.`
            : `${resultado.checkedIn} presentes.`,
      });
    },
    onError: avisarDelError,
  });

  if (roster.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando la lista">
        <Skeleton className="h-20" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  if (roster.isError) {
    return (
      <ErrorState
        title="No pudimos abrir la lista"
        message={mensajeDe(roster.error)}
        onRetry={() => void roster.refetch()}
        {...codigoDe(roster.error)}
        {...accionDe(roster.error)}
      />
    );
  }

  const lista = roster.data;
  const venue = { timeZone: lista.timeZone };
  const hora = (iso: string) => formatTime(Temporal.Instant.from(iso), venue);
  const anotados = lista.entries.filter((entry) => entry.status !== 'waitlisted');
  const enEspera = lista.entries.filter((entry) => entry.status === 'waitlisted');
  const faltanMarcar = anotados.some((entry) => entry.status === 'booked');

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-fg text-xl font-semibold">{lista.name}</h1>
            <p className="text-fg-muted text-sm">
              {hora(lista.startAt)} · {lista.presentCount} de {lista.bookedCount} presentes
            </p>
          </div>
          <Badge tone={lista.checkInOpen ? 'success' : 'neutral'}>
            {lista.checkInOpen ? 'Check-in abierto' : `Abre ${hora(lista.checkInOpensAt)}`}
          </Badge>
        </div>
      </Card>

      {anotados.length === 0 ? (
        <EmptyState
          title="Todavía no hay nadie anotado"
          description="Cuando alguien reserve, va a aparecer acá."
          action={
            <Button variant="secondary" onClick={() => void roster.refetch()}>
              Actualizar
            </Button>
          }
        />
      ) : (
        <>
          {/* La acción principal, arriba y del ancho de la pantalla: es el 90% de lo que el coach hace acá. */}
          <Button
            className="h-12 w-full"
            onClick={() => marcarTodos.mutate()}
            disabled={!lista.checkInOpen || !faltanMarcar || marcarTodos.isPending}
          >
            {marcarTodos.isPending ? 'Marcando…' : 'Todos presentes'}
          </Button>

          <ul className="flex flex-col gap-2" aria-label="Inscriptos">
            {anotados.map((entry) => (
              <li
                key={entry.bookingId}
                className="border-border bg-surface-2 flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <p className="text-fg truncate text-base font-medium">{entry.fullName}</p>
                  {entry.alerts.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.alerts.map((alerta) => (
                        <Badge key={alerta} tone="warning">
                          {ALERTAS[alerta]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {entry.status === 'checked_in' ? (
                  <Badge tone="success">Presente</Badge>
                ) : (
                  <Button
                    variant="secondary"
                    className="h-11 min-w-24 shrink-0"
                    onClick={() => marcar.mutate(entry.bookingId)}
                    disabled={!lista.checkInOpen || marcar.isPending}
                  >
                    Marcar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {enEspera.length > 0 && (
        <Card title={`Lista de espera (${enEspera.length})`}>
          <ul className="flex flex-col gap-2" aria-label="Lista de espera">
            {enEspera.map((entry) => (
              <li key={entry.bookingId} className="flex items-center justify-between gap-3">
                <span className="text-fg truncate">{entry.fullName}</span>
                <Badge tone="neutral">#{entry.waitlistPosition ?? '—'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Los códigos vienen del backend; el texto es de la app (§2.1.18). */
const ALERTAS: Record<string, string> = {
  debt: 'Debe',
  waiver_missing: 'Sin waiver',
  first_class: 'Primera clase',
  health_note: 'Salud',
};

const nuevaClave = () => globalThis.crypto.randomUUID();

/** El mensaje del envelope §5.0, o uno genérico si ni siquiera hubo respuesta. */
function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

/** Qué puede hacer el usuario. Sale del `action` del envelope (§5.0). */
function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}

/** El código y el `requestId` viajan al toast: es lo que el coach puede reportar. */
function codigoDe(error: unknown) {
  return error instanceof ApiRequestError ? { code: error.code, requestId: error.requestId } : {};
}
