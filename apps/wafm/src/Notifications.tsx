import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Notification, NotificationPreference } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '@laplace/ui';
import { api } from './api.js';

/**
 * Los avisos del socio (§2.1.14).
 *
 * Dos cosas en la misma pantalla a propósito: lo que llegó y el interruptor
 * para que deje de llegar. Un opt-out escondido en el perfil es un opt-out que
 * nadie encuentra, y la alternativa a no encontrarlo es marcar el mail como
 * spam — que se lleva puestos también los avisos de cuota.
 */
export interface NotificationsProps {
  client?: ApiClient;
}

interface Pagina {
  items: Notification[];
  nextCursor: string | null;
}

export function Notifications({ client = api }: NotificationsProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const avisos = useQuery({
    queryKey: ['notifications'],
    queryFn: () => client.get<Pagina>('/notifications'),
  });

  const preferencias = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => client.get<NotificationPreference[]>('/notification-preferences'),
  });

  const marcarLeido = useMutation({
    mutationFn: (id: string) => client.post(`/notifications/${id}/read`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const cambiarPreferencia = useMutation({
    mutationFn: (cambio: { eventType: string; channel: string; enabled: boolean }) =>
      client.put('/notification-preferences', { preferences: [cambio] }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  if (avisos.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando tus avisos">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (avisos.isError) {
    return (
      <ErrorState
        title="No pudimos traer tus avisos"
        message={mensajeDe(avisos.error)}
        onRetry={() => void avisos.refetch()}
        {...accionDe(avisos.error)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-fg text-xl font-semibold">Tus avisos</h1>

      {avisos.data.items.length === 0 ? (
        <EmptyState
          title="No tenés avisos"
          description="Acá te van a llegar las confirmaciones de tus reservas y los recordatorios de clase."
          action={<Button disabled>Al día</Button>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {avisos.data.items.map((aviso) => (
            <li key={aviso.publicId}>
              <Card
                title={aviso.subject}
                actions={aviso.readAt ? undefined : <Badge tone="warning">Nuevo</Badge>}
              >
                <div className="flex flex-col gap-3">
                  <p className="text-fg-muted text-sm">{aviso.body}</p>
                  {!aviso.readAt && (
                    <Button
                      variant="secondary"
                      className="h-11 self-start"
                      onClick={() => marcarLeido.mutate(aviso.publicId)}
                      disabled={marcarLeido.isPending}
                    >
                      Marcar como leído
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-fg text-lg font-semibold">Qué querés recibir</h2>

        {preferencias.isError ? (
          <ErrorState
            title="No pudimos traer tus preferencias"
            message={mensajeDe(preferencias.error)}
            onRetry={() => void preferencias.refetch()}
          />
        ) : preferencias.isPending ? (
          <Skeleton className="h-32" aria-label="Cargando tus preferencias" />
        ) : (
          <ul className="flex flex-col gap-2">
            {preferencias.data.map((pref) => (
              <li key={`${pref.eventType}:${pref.channel}`}>
                <Checkbox
                  label={`${etiquetaDe(pref.eventType)} · ${CANALES[pref.channel] ?? pref.channel}`}
                  checked={pref.enabled}
                  // Los avisos de plata no se pueden apagar (§2.1.14): el
                  // interruptor se muestra igual, deshabilitado, para que
                  // quede claro que no es un olvido.
                  disabled={pref.critical || cambiarPreferencia.isPending}
                  {...(pref.critical ? { description: 'Este aviso siempre se envía.' } : {})}
                  onChange={(event) =>
                    cambiarPreferencia.mutate({
                      eventType: pref.eventType,
                      channel: pref.channel,
                      enabled: event.currentTarget.checked,
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const CANALES: Record<string, string> = {
  in_app: 'en la app',
  email: 'por mail',
};

const ETIQUETAS: Record<string, string> = {
  'booking.created': 'Confirmación de reserva',
  'booking.cancelled': 'Cancelación de reserva',
  'booking.waitlist_promoted': 'Se liberó un lugar',
  'session.reminder_24h': 'Recordatorio del día anterior',
  'session.reminder_1h': 'Recordatorio de una hora antes',
  'session.cancelled': 'Clase cancelada',
  'session.coach_changed': 'Cambio de coach',
  'contract.expiring': 'Tu pack está por vencer',
  'contract.expired': 'Tu pack venció',
  'charge.overdue': 'Pago pendiente',
  'payment.received': 'Pago recibido',
};

function etiquetaDe(eventType: string): string {
  return ETIQUETAS[eventType] ?? eventType;
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
