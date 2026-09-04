import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Alert, AlertType, Dashboard, DashboardSession } from '@laplace/schemas';
import { ApiRequestError, useUiStore, type ApiClient } from '@laplace/client';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@laplace/ui';
import { api } from './api.js';

/**
 * El home del DFSM es un **tablero, no un menú** (§5.1.2).
 *
 * Lo que se ve al abrirlo es lo que hay que hacer hoy: las clases con su
 * ocupación, cuánta gente entró, la caja del día y las alertas. Navegar a otra
 * pantalla para enterarse de algo es exactamente lo que un tablero evita.
 *
 * 🔴 **Las alertas van arriba de los números.** §2.1.12 dice que el panel de
 * alertas vale más que cualquier gráfico, y el motivo es concreto: un gráfico
 * se mira, una alerta se toca.
 */
export interface HomeProps {
  client?: ApiClient;
}

export function Home({ client = api }: HomeProps = {}) {
  const activeVenueId = useUiStore((state) => state.activeVenueId);

  const tablero = useQuery({
    queryKey: ['dashboard', activeVenueId],
    queryFn: () => client.get<Dashboard>(`/dashboard?venueId=${activeVenueId ?? ''}`),
    enabled: Boolean(activeVenueId),
  });

  if (!activeVenueId) {
    return (
      <EmptyState
        title="Elegí un centro"
        description="El tablero muestra el día de una sede a la vez."
        action={<Button disabled>Sin centro activo</Button>}
      />
    );
  }

  if (tablero.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando el tablero">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (tablero.isError) {
    return (
      <ErrorState
        title="No pudimos abrir el tablero"
        message={mensajeDe(tablero.error)}
        onRetry={() => void tablero.refetch()}
        {...accionDe(tablero.error)}
      />
    );
  }

  const { sessions, alerts, money, checkedIn, booked } = tablero.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-fg text-xl font-semibold">Hoy</h1>
        <p className="text-fg-muted text-sm">{tablero.data.date}</p>
      </header>

      <section aria-label="Alertas" className="flex flex-col gap-3">
        {alerts.every((alerta) => alerta.count === 0) ? (
          <Card title="Sin alertas">
            <p className="text-fg-muted text-sm">
              Nadie faltando, nada por vencer y ninguna clase floja. Buen día.
            </p>
          </Card>
        ) : (
          alerts
            .filter((alerta) => alerta.count > 0)
            .map((alerta) => <AlertCard key={alerta.type} alert={alerta} />)
        )}
      </section>

      <section aria-label="El día" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Reservas de hoy" value={String(booked)} />
        <Metric label="Entraron" value={String(checkedIn)} />
        {money ? (
          <>
            <Metric label="Cobrado hoy" value={montoDe(money.incomeCents)} />
            <Metric
              label="Deuda vencida"
              value={montoDe(money.overdueCents)}
              {...(money.overdueCents > 0 ? { badge: 'Hay deuda' } : {})}
            />
          </>
        ) : null}
      </section>

      <section aria-label="Clases de hoy" className="flex flex-col gap-3">
        <h2 className="text-fg text-lg font-semibold">Clases de hoy</h2>
        {sessions.length === 0 ? (
          <EmptyState
            title="Todavía no tenés clases"
            description="Creá la primera y empezá a recibir reservas."
            action={<Button>Crear la primera</Button>}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((clase) => (
              <li key={clase.sessionId}>
                <SessionRow session={clase} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Una clase del día: hora, nombre y cuántos de cuántos. */
function SessionRow({ session }: { session: DashboardSession }) {
  return (
    <Link
      to="/clases/$sessionId"
      params={{ sessionId: session.sessionId }}
      className="border-border bg-surface-2 hover:bg-surface-3 focus-visible:focus-ring flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2"
    >
      <span className="flex items-baseline gap-3">
        <span className="text-fg font-mono text-sm">{session.startsAtLocal}</span>
        <span className="text-fg font-medium">{session.name}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-fg-muted text-sm">
          {session.booked} de {session.capacity}
        </span>
        {session.checkedIn > 0 && <Badge tone="success">{session.checkedIn} adentro</Badge>}
      </span>
    </Link>
  );
}

/**
 * Una alerta con sus primeros ítems. Cada uno lleva a la acción que lo
 * resuelve: la ficha del socio o la clase (§2.1.12).
 */
function AlertCard({ alert }: { alert: Alert }) {
  return (
    <Card
      title={TITULOS[alert.type]}
      actions={<Badge tone={TONOS[alert.type]}>{alert.count}</Badge>}
    >
      <ul className="flex flex-col gap-1">
        {alert.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-fg text-sm font-medium">{item.label}</span>
            <span className="text-fg-muted text-sm">{item.detail}</span>
          </li>
        ))}
      </ul>
      {alert.count > alert.items.length && (
        <p className="text-fg-muted mt-2 text-sm">y {alert.count - alert.items.length} más.</p>
      )}
    </Card>
  );
}

/**
 * Un número del día. La señal de alarma va en un badge y no coloreando el
 * número: el amarillo de `warning` sobre una superficie clara no llega al
 * contraste AA, y un número que no se lee no avisa nada.
 */
function Metric({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="border-border bg-surface-2 flex flex-col gap-1 rounded-md border px-3 py-2">
      <span className="text-fg-muted flex items-center gap-2 text-sm">
        {label}
        {badge ? <Badge tone="warning">{badge}</Badge> : null}
      </span>
      <span className="text-fg text-2xl font-semibold">{value}</span>
    </div>
  );
}

const TITULOS: Record<AlertType, string> = {
  inactive_members: 'No vienen hace dos semanas',
  expiring_contracts: 'Packs que vencen esta semana',
  debtors: 'Deudores',
  low_occupancy: 'Clases flojas esta semana',
  missing_waivers: 'Sin firmar el deslinde',
};

const TONOS: Record<AlertType, 'warning' | 'danger' | 'neutral'> = {
  inactive_members: 'warning',
  expiring_contracts: 'warning',
  debtors: 'danger',
  low_occupancy: 'neutral',
  missing_waivers: 'danger',
};

/** "$18.000". Los montos viajan en centavos enteros (§5.2.2). */
function montoDe(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('es-AR')}`;
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
