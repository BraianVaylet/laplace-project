import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HealthPanel, SupportHit } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  FormField,
  Input,
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
 * La salud del SaaS y el buscador de soporte (§11.3).
 *
 * El buscador es lo que hace verdadera la frase que el producto le dice al
 * usuario en cada error: "compartí el código con soporte". Del otro lado hay
 * dónde pegarlo.
 *
 * 🔴 Lo que se ve es **qué** pasó y **dónde**, nunca los datos de quién lo
 * sufrió: el mensaje y el `meta` del error no salen de la API (ADR-004,
 * decisión 7).
 */
export interface HealthProps {
  client?: ApiClient;
}

export function Health({ client = api }: HealthProps = {}) {
  const [busqueda, setBusqueda] = useState<string | null>(null);

  const salud = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => client.get<HealthPanel>('/admin/health'),
  });

  const soporte = useQuery({
    queryKey: ['admin', 'support', busqueda],
    queryFn: () => client.get<SupportHit[]>(`/admin/support?${busqueda ?? ''}`),
    enabled: busqueda !== null,
  });

  const buscar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const termino = String(new FormData(event.currentTarget).get('termino') ?? '').trim();
    if (termino.length === 0) return;

    /*
     * Un código tiene forma `LP-MOD-500-001`; cualquier otra cosa es un
     * `requestId`. Se decide acá para no hacerle elegir al que está apurado
     * atendiendo a alguien.
     */
    const esCodigo = /^LP-[A-Z]{2,4}-\d{3}-\d{3}$/.test(termino.toUpperCase());
    setBusqueda(
      esCodigo
        ? `errorCode=${encodeURIComponent(termino.toUpperCase())}`
        : `requestId=${encodeURIComponent(termino)}`,
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-fg text-xl font-semibold">Salud del sistema</h1>

      <Card title="Buscar qué pasó">
        <form onSubmit={buscar} className="flex flex-col gap-3">
          <FormField
            label="requestId o código de error"
            description="Pegá lo que te pasó el usuario. Ej: LP-BOOK-409-002."
          >
            <Input name="termino" />
          </FormField>
          <div>
            <Button type="submit">Buscar</Button>
          </div>
        </form>

        {busqueda !== null && soporte.isSuccess ? (
          soporte.data.length === 0 ? (
            <p className="text-fg-muted mt-4 text-sm">
              No hay nada con ese dato. Puede haber pasado hace más de 30 días.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <Table caption="Errores que coinciden con la búsqueda">
                <THead>
                  <TR>
                    <TH>Cuándo</TH>
                    <TH>Código</TH>
                    <TH>Estado</TH>
                    <TH>Dónde</TH>
                  </TR>
                </THead>
                <TBody>
                  {soporte.data.map((hit) => (
                    <TR key={`${hit.requestId}-${hit.at}`}>
                      <TD>{hit.at}</TD>
                      <TD>{hit.code}</TD>
                      <TD>{hit.status}</TD>
                      <TD>
                        {hit.method} {hit.path}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )
        ) : null}
      </Card>

      {salud.isPending ? (
        <Skeleton className="h-64" aria-label="Cargando la salud del sistema" />
      ) : salud.isError ? (
        <ErrorState
          title="No pudimos traer la salud del sistema"
          message={mensajeDe(salud.error)}
          onRetry={() => void salud.refetch()}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            title="Errores de las últimas 24 h"
            actions={<Badge tone="neutral">{salud.data.errorsByCode.length} códigos</Badge>}
          >
            {salud.data.errorsByCode.length === 0 ? (
              <p className="text-fg-muted text-sm">Ningún error. Buen día.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {salud.data.errorsByCode.map((fila) => (
                  <li key={fila.code} className="flex justify-between gap-3">
                    <span className="font-mono">{fila.code}</span>
                    <span className="text-fg-muted">{fila.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Jobs fallidos"
            actions={
              <Badge tone={salud.data.failedJobs.length > 0 ? 'danger' : 'success'}>
                {salud.data.failedJobs.length}
              </Badge>
            }
          >
            {salud.data.failedJobs.length === 0 ? (
              <p className="text-fg-muted text-sm">Ninguno falló en las últimas 24 h.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {salud.data.failedJobs.map((job) => (
                  <li key={`${job.name}-${job.at}`}>
                    <span className="font-medium">{job.name}</span>
                    <span className="text-fg-muted block">{job.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Suscriptores">
            <ul className="flex flex-col gap-1 text-sm">
              <li className="flex justify-between">
                <span>Total</span>
                <span className="text-fg-muted">{salud.data.subscribers.total}</span>
              </li>
              <li className="flex justify-between">
                <span>En prueba</span>
                <span className="text-fg-muted">{salud.data.subscribers.trial}</span>
              </li>
              <li className="flex justify-between">
                <span>Activos</span>
                <span className="text-fg-muted">{salud.data.subscribers.active}</span>
              </li>
              <li className="flex justify-between">
                <span>Suspendidos</span>
                <span className="text-fg-muted">{salud.data.subscribers.suspended}</span>
              </li>
            </ul>
          </Card>

          <Card title="Webhooks pendientes">
            <p className="text-2xl font-semibold">{salud.data.pendingWebhooks}</p>
            <p className="text-fg-muted text-sm">
              Los webhooks entran con Mercado Pago, en Fase 2. Hasta entonces siempre es cero.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}
