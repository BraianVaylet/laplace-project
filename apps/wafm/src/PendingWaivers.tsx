import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PendingDocument } from '@laplace/schemas';
import { ApiRequestError, sanitizeHtml, type ApiClient } from '@laplace/client';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast } from '@laplace/ui';
import { api } from './api.js';

/**
 * Los documentos que el socio tiene que firmar (§2.1.20).
 *
 * Es riesgo legal, no una funcionalidad opcional: mientras algo obligatorio
 * siga sin firmar, el check-in queda bloqueado (si el centro lo exige). Por
 * eso cada documento muestra su texto completo acá mismo — nadie firma algo
 * que no pudo leer.
 */
export interface PendingWaiversProps {
  client?: ApiClient;
}

export function PendingWaivers({ client = api }: PendingWaiversProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [abierto, setAbierto] = useState<string | null>(null);

  const pendientes = useQuery({
    queryKey: ['legal-documents', 'pending'],
    queryFn: () => client.get<PendingDocument[]>('/legal-documents/pending'),
  });

  const aceptar = useMutation({
    mutationFn: (documentId: string) => client.post(`/legal-documents/${documentId}/accept`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legal-documents', 'pending'] }),
    onError: (error: unknown) =>
      toast.show({ tone: 'danger', message: mensajeDe(error), ...accionDe(error) }),
  });

  if (pendientes.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Cargando tus documentos">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (pendientes.isError) {
    return (
      <ErrorState
        title="No pudimos traer tus documentos"
        message={mensajeDe(pendientes.error)}
        onRetry={() => void pendientes.refetch()}
        {...accionDe(pendientes.error)}
      />
    );
  }

  const documentos = pendientes.data;
  const sinFirmar = documentos.filter((doc) => !doc.accepted);

  if (documentos.length === 0) {
    return (
      <EmptyState
        title="No tenés nada pendiente"
        description="El centro no publicó documentos que necesiten tu firma."
        action={<Button disabled>Al día</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Tus documentos</h1>
      {sinFirmar.length > 0 && (
        <p className="text-fg-muted text-sm">
          Te falta{sinFirmar.length === 1 ? '' : 'n'} firmar {sinFirmar.length}.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {documentos.map((doc) => (
          <li key={doc.publicId}>
            <Card
              title={doc.title}
              actions={
                doc.accepted ? (
                  <Badge tone="success">Firmado</Badge>
                ) : (
                  <Badge tone="warning">Pendiente</Badge>
                )
              }
            >
              <div className="flex flex-col gap-3">
                {abierto === doc.publicId ? (
                  // El HTML lo escribe el staff del centro, no un socio ni
                  // Laplace: pasa por `sanitizeHtml` antes de renderizarse
                  // para que una cuenta de staff comprometida no pueda
                  // convertirse en un XSS contra cada socio que abre la app.
                  <div
                    className="text-fg prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(doc.contentHtml) }}
                  />
                ) : (
                  <button
                    type="button"
                    className="text-brand-500 self-start text-sm underline"
                    onClick={() => setAbierto(doc.publicId)}
                  >
                    Leer el texto completo
                  </button>
                )}

                {!doc.accepted && (
                  <Button
                    className="h-11 self-start"
                    onClick={() => aceptar.mutate(doc.publicId)}
                    disabled={aceptar.isPending}
                  >
                    Acepto
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
