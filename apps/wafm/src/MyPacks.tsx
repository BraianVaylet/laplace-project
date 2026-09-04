import { useQuery } from '@tanstack/react-query';
import type { MyContract } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@laplace/ui';
import { api } from './api.js';

/**
 * Mis packs (§2.1.2).
 *
 * Contesta dos preguntas y nada más: **cuántas clases me quedan** y **hasta
 * cuándo**. Son las dos que el socio se hace antes de reservar, y las que hoy
 * termina preguntando por WhatsApp.
 *
 * El pack agotado o vencido se sigue mostrando: "no te queda ninguna" es una
 * respuesta, y esconderlo deja al socio sin entender por qué no puede reservar.
 */
export interface MyPacksProps {
  client?: ApiClient;
}

export function MyPacks({ client = api }: MyPacksProps = {}) {
  const packs = useQuery({
    queryKey: ['my', 'contracts'],
    queryFn: () => client.get<MyContract[]>('/my/contracts'),
  });

  if (packs.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando tus packs">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (packs.isError) {
    return (
      <ErrorState
        title="No pudimos traer tus packs"
        message={mensajeDe(packs.error)}
        onRetry={() => void packs.refetch()}
        {...accionDe(packs.error)}
      />
    );
  }

  if (packs.data.length === 0) {
    return (
      <EmptyState
        title="Todavía no tenés ningún pack"
        description="Cuando compres uno en el centro, lo vas a ver acá con las clases que te quedan."
        action={<Button disabled>Sin packs</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Mis packs</h1>

      <ul className="flex flex-col gap-3">
        {packs.data.map((pack) => (
          <li key={pack.contractId}>
            <PackCard pack={pack} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PackCard({ pack }: { pack: MyContract }) {
  const activo = pack.status === 'active';

  return (
    <Card
      title={pack.productName}
      actions={
        <Badge tone={TONOS[pack.status] ?? 'neutral'}>
          {ETIQUETAS[pack.status] ?? pack.status}
        </Badge>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg text-lg font-semibold">{creditosDe(pack)}</p>

        <p className="text-fg-muted text-sm">{vencimientoDe(pack)}</p>

        {pack.allowedCategories.length > 0 && (
          <p className="text-fg-muted text-sm">Sirve para: {pack.allowedCategories.join(', ')}.</p>
        )}

        {/*
         * El CTA aparece cuando vence esta semana o cuando ya no sirve: es
         * cuando renovar cambia algo. Antes es ruido.
         */}
        {(pack.expiringSoon || !activo) && (
          <Button variant="secondary" className="h-11 self-start">
            Renovar en el centro
          </Button>
        )}
      </div>
    </Card>
  );
}

/** "Te quedan 3 de 8 clases" — o el texto de una membresía, que no cuenta clases. */
function creditosDe(pack: MyContract): string {
  if (pack.creditsLeft === null) return 'Membresía: entrás las veces que quieras.';
  if (pack.creditsLeft === 0) return 'No te quedan clases.';

  return `Te ${pack.creditsLeft === 1 ? 'queda' : 'quedan'} ${pack.creditsLeft} de ${pack.creditsTotal ?? pack.creditsLeft} ${pack.creditsLeft === 1 ? 'clase' : 'clases'}.`;
}

function vencimientoDe(pack: MyContract): string {
  if (pack.endsAt === null) return 'No vence.';
  if (pack.daysLeft === null) return 'No vence.';
  if (pack.daysLeft < 0) return 'Ya venció.';
  if (pack.daysLeft === 0) return 'Vence hoy.';

  return `Vence en ${pack.daysLeft} ${pack.daysLeft === 1 ? 'día' : 'días'}.`;
}

const ETIQUETAS: Record<string, string> = {
  active: 'Activo',
  frozen: 'Congelado',
  expired: 'Vencido',
  exhausted: 'Sin clases',
  cancelled: 'Cancelado',
  pending_payment: 'Falta pagarlo',
};

const TONOS: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  frozen: 'warning',
  expired: 'neutral',
  exhausted: 'warning',
  cancelled: 'neutral',
  pending_payment: 'danger',
};

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
