import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Venue } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Select,
  Skeleton,
  useToast,
} from '@laplace/ui';
import { api } from './api.js';

/**
 * Las sedes del centro (§2.1.4, F1-33).
 *
 * Es la primera pantalla del centro nuevo: sin sede no hay dónde poner una
 * clase, un producto ni un socio, y el asistente de primeros pasos se queda
 * trabado acá.
 *
 * 🔴 **El tope del plan lo decide el servidor.** La pantalla muestra el error
 * tipado tal cual viene, con su límite y su plan. Adivinarlo en el front sería
 * una segunda fuente de verdad que un día dice otra cosa que el backend.
 */
export interface VenuesProps {
  client?: ApiClient;
}

export function Venues({ client = api }: VenuesProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);

  const sedes = useQuery({
    queryKey: ['venues'],
    queryFn: () => client.get<{ items: Venue[]; nextCursor: string | null }>('/venues'),
  });

  const crear = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.post<Venue>('/venues', datos),
    onSuccess: async (sede) => {
      setAbierto(false);
      toast.show({ tone: 'success', message: `Creamos ${sede.name}.` });
      await queryClient.invalidateQueries({ queryKey: ['venues'] });
      // El asistente de primeros pasos cuenta sedes: que se entere ya.
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  if (sedes.isPending) return <Skeleton className="h-64" label="Cargando tus sedes" />;

  if (sedes.isError) {
    return (
      <ErrorState
        title="No pudimos traer tus sedes"
        message={mensajeDe(sedes.error)}
        onRetry={() => void sedes.refetch()}
        {...accionDe(sedes.error)}
      />
    );
  }

  const enviar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    crear.mutate({
      name: datos['name'],
      address: datos['address'],
      timeZone: datos['timeZone'],
      ...(datos['phone'] ? { phone: datos['phone'] } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-fg text-xl font-semibold">Sedes</h1>
        {sedes.data.items.length > 0 ? (
          <Button onClick={() => setAbierto(true)}>Crear sede</Button>
        ) : null}
      </header>

      {sedes.data.items.length === 0 ? (
        <EmptyState
          title="Todavía no tenés ninguna sede"
          description="Es el lugar donde entrenan. Su zona horaria y sus horarios salen de acá."
          action={<Button onClick={() => setAbierto(true)}>Crear la primera</Button>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {sedes.data.items.map((sede) => (
            <li key={sede.publicId}>
              <Card title={sede.name}>
                <div className="flex flex-col gap-2">
                  <p className="text-fg-muted text-sm">{sede.address}</p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={sede.status === 'active' ? 'success' : 'neutral'}>
                      {sede.status === 'active' ? 'Activa' : 'Archivada'}
                    </Badge>
                    <span className="text-fg-muted text-sm">{sede.timeZone}</span>
                    {/*
                      Una sede sin horario deja publicar clases con todo cerrado.
                      Decirlo acá es más barato que descubrirlo cuando un socio
                      se presenta a la puerta.
                    */}
                    {sede.businessHours.length === 0 ? (
                      <Badge tone="warning">Sin horarios cargados</Badge>
                    ) : (
                      <span className="text-fg-muted text-sm">{resumenDe(sede)}</span>
                    )}
                  </div>

                  <div>
                    <a
                      href={`/sedes/${sede.publicId}`}
                      className="bg-surface-2 text-fg hover:bg-surface-3 focus-visible:outline-brand-500 inline-flex h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      Configurar
                    </a>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Crear una sede"
        description="Después vas a poder cargar sus horarios y su política de reserva."
      >
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <FormField label="Nombre" required>
            <Input name="name" required minLength={2} maxLength={80} autoFocus />
          </FormField>

          <FormField label="Dirección" required description="Es la que ve el socio en la app.">
            <Input name="address" required minLength={5} maxLength={200} />
          </FormField>

          <FormField label="Teléfono">
            <Input name="phone" type="tel" />
          </FormField>

          <FormField
            label="Zona horaria"
            required
            description="Los vencimientos y los horarios se calculan acá, no en el teléfono de cada uno."
          >
            <Select name="timeZone" options={ZONAS} defaultValue={ZONA_POR_DEFECTO} required />
          </FormField>

          {/*
            El error del límite de plan va acá y no en un toast: es la respuesta
            a lo que la persona acaba de intentar, y un toast se va justo cuando
            lo está leyendo.
          */}
          {crear.isError ? (
            <div role="alert" className="text-danger-600 flex flex-col gap-1 text-sm">
              <span>{mensajeDe(crear.error)}</span>
              {crear.error instanceof ApiRequestError && crear.error.action ? (
                <span className="text-fg-muted">{crear.error.action}</span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={crear.isPending}>
              {crear.isPending ? 'Creando…' : 'Crear'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

/** Las zonas del país, más la del navegador si no fuera ninguna de esas. */
const ZONAS_AR = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Cordoba',
  'America/Argentina/Mendoza',
  'America/Argentina/Salta',
  'America/Argentina/Tucuman',
  'America/Argentina/Ushuaia',
];

const ZONA_DEL_NAVEGADOR = Intl.DateTimeFormat().resolvedOptions().timeZone;

const ZONAS = [
  ...ZONAS_AR,
  ...(ZONAS_AR.includes(ZONA_DEL_NAVEGADOR) ? [] : [ZONA_DEL_NAVEGADOR]),
].map((zona) => ({ value: zona, label: zona.replace('America/Argentina/', '').replace('_', ' ') }));

const ZONA_POR_DEFECTO = ZONAS_AR.includes(ZONA_DEL_NAVEGADOR)
  ? ZONA_DEL_NAVEGADOR
  : 'America/Argentina/Buenos_Aires';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** "Lunes a viernes de 06:00 a 22:00" cuando se puede; si no, cuántos días tiene. */
function resumenDe(sede: Venue): string {
  const dias = [...sede.businessHours].sort((a, b) => a.weekday - b.weekday);
  const primero = dias[0];
  if (!primero) return 'Sin horarios cargados';

  const mismoHorario = dias.every(
    (dia) => dia.opensAt === primero.opensAt && dia.closesAt === primero.closesAt,
  );
  if (!mismoHorario) return `${dias.length} días con horario`;

  const rango =
    dias.length === 1
      ? DIAS[primero.weekday]
      : `${DIAS[primero.weekday]} a ${DIAS[dias[dias.length - 1]?.weekday ?? 0]}`;

  return `${rango} de ${primero.opensAt} a ${primero.closesAt}`;
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
