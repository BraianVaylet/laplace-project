import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { PendingDocument } from '@laplace/schemas';
import type { ApiClient } from '@laplace/client';
import { Button, Card, EmptyState } from '@laplace/ui';
import { api } from './api.js';

export interface HomeProps {
  client?: ApiClient;
}

/** El home del socio. Lo llena F1-28/F1-29; hoy es el punto de entrada. */
export function Home({ client = api }: HomeProps = {}) {
  // Silencioso ante un error: el home no se cae porque el aviso de firma no
  // pudo cargar. La pantalla de "Tus documentos" tiene su propio error state.
  const pendientes = useQuery({
    queryKey: ['legal-documents', 'pending'],
    queryFn: () => client.get<PendingDocument[]>('/legal-documents/pending'),
    retry: false,
    throwOnError: false,
  });
  const sinFirmar = pendientes.data?.filter((doc) => !doc.accepted).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Hoy</h1>

      {sinFirmar > 0 && (
        <Card title="Tenés documentos para firmar">
          <div className="flex items-center justify-between gap-3">
            <p className="text-fg-muted text-sm">
              El centro publicó {sinFirmar} documento{sinFirmar === 1 ? '' : 's'} que todavía no
              firmaste.
            </p>
            <Link to="/documentos">
              <Button variant="secondary">Ver</Button>
            </Link>
          </div>
        </Card>
      )}

      <Card title="Tus próximas clases">
        <EmptyState
          title="No tenés reservas"
          description="Mirá el horario del centro y anotate."
          action={<Button>Ver horario</Button>}
        />
      </Card>
    </div>
  );
}
