import { useQuery } from '@tanstack/react-query';
import type { SubscriberUsage } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@laplace/ui';
import { api } from './api.js';

/**
 * El listado de suscriptores (§5.1.1).
 *
 * 🔴 **Son conteos, no personas.** El SAU ve cuántos socios tiene un centro,
 * nunca quiénes son (ADR-004, decisión 7). Para ver datos de un centro hay un
 * solo camino, y es la impersonación auditada — que le avisa al dueño.
 */
export interface SubscribersProps {
  client?: ApiClient;
}

export function Subscribers({ client = api }: SubscribersProps = {}) {
  const suscriptores = useQuery({
    queryKey: ['admin', 'subscribers'],
    queryFn: () => client.get<SubscriberUsage[]>('/admin/subscribers'),
  });

  if (suscriptores.isPending) {
    return <Skeleton className="h-64" aria-label="Cargando los suscriptores" />;
  }

  if (suscriptores.isError) {
    return (
      <ErrorState
        title="No pudimos traer los suscriptores"
        message={mensajeDe(suscriptores.error)}
        onRetry={() => void suscriptores.refetch()}
      />
    );
  }

  if (suscriptores.data.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay suscriptores"
        description="Los centros se dan de alta solos desde la landing, con el trial de 14 días."
        action={
          <a href="/" className="focus-visible:focus-ring rounded">
            <Button variant="secondary">Ver la landing</Button>
          </a>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Suscriptores</h1>

      <div className="overflow-x-auto">
        <Table caption="Suscriptores con su plan, su estado y su uso contra los límites">
          <THead>
            <TR>
              <TH>Centro</TH>
              <TH>Estado</TH>
              <TH>Plan</TH>
              <TH>Sedes</TH>
              <TH>Socios</TH>
              <TH>Staff</TH>
            </TR>
          </THead>
          <TBody>
            {suscriptores.data.map((suscriptor) => (
              <TR key={suscriptor.organizationId}>
                <TD>{suscriptor.centerName}</TD>
                <TD>
                  <Badge tone={TONO_POR_ESTADO[suscriptor.status] ?? 'neutral'}>
                    {ETIQUETA_POR_ESTADO[suscriptor.status] ?? suscriptor.status}
                  </Badge>
                </TD>
                <TD>
                  {suscriptor.planId}
                  {suscriptor.overLimit ? (
                    <Badge tone="warning" className="ml-2">
                      Pasó el tope
                    </Badge>
                  ) : null}
                </TD>
                <TD>{uso(suscriptor.usage.venues, suscriptor.limits.venues)}</TD>
                <TD>{uso(suscriptor.usage.activeMembers, suscriptor.limits.activeMembers)}</TD>
                <TD>{uso(suscriptor.usage.staffUsers, suscriptor.limits.staffUsers)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <p className="text-fg-muted text-sm">
        Son conteos, no personas: para ver los datos de un centro hay que entrar con soporte, que
        queda registrado y le avisa al dueño de la cuenta.
      </p>
    </div>
  );
}

/** "12 de 60" o "12 de ∞": un plan sin techo se lee de un vistazo. */
function uso(usado: number, tope: number | null): string {
  return `${usado} de ${tope === null ? '∞' : tope}`;
}

const ETIQUETA_POR_ESTADO: Record<string, string> = {
  trial: 'En prueba',
  active: 'Activo',
  past_due: 'Atrasado',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
  blocked: 'Bloqueado',
};

const TONO_POR_ESTADO: Record<string, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  trial: 'brand',
  active: 'success',
  past_due: 'warning',
  suspended: 'danger',
  cancelled: 'neutral',
  blocked: 'danger',
};

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}
