import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
import type { InviteCode, MemberResponse, Venue } from '@laplace/schemas';
import { ApiRequestError, formatDate, type ApiClient, type VenueTime } from '@laplace/client';
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
 * El padrón del centro (§2.1.7) y los códigos de invitación (§2.1.4) — F1-36.
 *
 * 🔴 **La columna de saldo no existe para quien no puede ver plata.** La API ya
 * manda `null` desde F1-06; pintar un "$0" sería inventar un dato que además
 * está mal (§2.1.12).
 *
 * Los filtros van **en el pedido**, no en el navegador: filtrar en el cliente
 * sobre una página funciona hasta el socio 51.
 */
export interface MembersProps {
  client?: ApiClient;
}

const ESTADOS = [
  { value: 'lead', label: 'Interesado' },
  { value: 'active', label: 'Activo' },
  { value: 'inactive', label: 'Inactivo' },
  { value: 'suspended', label: 'Suspendido' },
  { value: 'archived', label: 'Archivado' },
];

export function Members({ client = api }: MembersProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [estado, setEstado] = useState('');
  const [alta, setAlta] = useState(false);
  const [nuevoCodigo, setNuevoCodigo] = useState(false);
  const [aRevocar, setARevocar] = useState<InviteCode | null>(null);

  const sedes = useQuery({
    queryKey: ['venues'],
    queryFn: () => client.get<{ items: Venue[] }>('/venues'),
  });
  const zona: VenueTime = {
    timeZone: sedes.data?.items[0]?.timeZone ?? 'America/Argentina/Buenos_Aires',
  };

  const socios = useQuery({
    queryKey: ['members', estado],
    queryFn: () =>
      client.get<{ items: MemberResponse[] }>(`/members${estado ? `?status=${estado}` : ''}`),
  });

  const codigos = useQuery({
    queryKey: ['invite-codes'],
    queryFn: () => client.get<{ items: InviteCode[] }>('/invite-codes'),
  });

  const crearSocio = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.post('/members', datos),
    onSuccess: async () => {
      setAlta(false);
      toast.show({ tone: 'success', message: 'Agregamos al socio.' });
      await queryClient.invalidateQueries({ queryKey: ['members'] });
    },
  });

  const generar = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.post('/invite-codes', datos),
    onSuccess: async () => {
      setNuevoCodigo(false);
      toast.show({ tone: 'success', message: 'Generamos el código.' });
      await queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
      // El asistente de primeros pasos cuenta códigos vigentes.
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const revocar = useMutation({
    mutationFn: (publicId: string) => client.post(`/invite-codes/${publicId}/revoke`, {}),
    onSuccess: async () => {
      setARevocar(null);
      toast.show({ tone: 'success', message: 'El código dejó de funcionar.' });
      await queryClient.invalidateQueries({ queryKey: ['invite-codes'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  if (socios.isPending) return <Skeleton className="h-64" label="Cargando los socios" />;

  if (socios.isError) {
    return (
      <ErrorState
        title="No pudimos traer los socios"
        message={mensajeDe(socios.error)}
        onRetry={() => void socios.refetch()}
        {...accionDe(socios.error)}
      />
    );
  }

  /*
   * 🔴 La columna existe solo si la API mandó saldos. Cuando quien mira no
   * puede ver plata llegan en `null`, y una columna de ceros sería un dato
   * inventado y equivocado.
   */
  const veLaPlata = socios.data.items.some((socio) => socio.balanceCents !== null);

  const agregarSocio = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    crearSocio.mutate({
      venueIds: [datos['venueId']].filter(Boolean),
      firstName: datos['firstName'],
      lastName: datos['lastName'],
      ...(datos['phone'] ? { phone: datos['phone'] } : {}),
      ...(datos['email'] ? { email: datos['email'] } : {}),
      ...(datos['birthDate'] ? { birthDate: datos['birthDate'] } : {}),
      status: 'active',
    });
  };

  const generarCodigo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    generar.mutate({
      venueId: datos['venueId'],
      maxUses: Number(datos['maxUses']),
      // La fecha se elige por día; el vencimiento es al final de ese día.
      expiresAt: `${datos['expiresAt']}T23:59:59Z`,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-fg text-xl font-semibold">Socios</h1>
        <Button onClick={() => setAlta(true)}>Agregar socio</Button>
      </header>

      <Card title="Padrón">
        <div className="flex flex-col gap-4">
          <FormField label="Estado" className="max-w-60">
            <Select
              options={ESTADOS}
              placeholder="Todos"
              value={estado}
              onChange={(event) => setEstado(event.currentTarget.value)}
            />
          </FormField>

          {socios.data.items.length === 0 ? (
            <EmptyState
              title="Todavía no tenés socios"
              description="El camino corto es un código de invitación: cada uno se asocia solo desde la app."
              action={<Button onClick={() => setNuevoCodigo(true)}>Generar un código</Button>}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {socios.data.items.map((socio) => (
                <li
                  key={socio.publicId}
                  className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 first:border-t-0 first:pt-0"
                >
                  <a
                    href={`/miembros/${socio.publicId}`}
                    className="text-fg focus-visible:outline-brand-500 min-w-48 flex-1 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2"
                  >
                    {socio.firstName} {socio.lastName}
                  </a>

                  <Badge tone={socio.status === 'active' ? 'success' : 'neutral'}>
                    {ESTADOS.find((e) => e.value === socio.status)?.label ?? socio.status}
                  </Badge>

                  {veLaPlata && socio.balanceCents !== null ? (
                    <span
                      className={
                        socio.balanceCents < 0 ? 'text-danger-600 text-sm' : 'text-fg-muted text-sm'
                      }
                    >
                      {socio.balanceCents < 0 ? 'Debe ' : ''}
                      {pesos(Math.abs(socio.balanceCents))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="Códigos de invitación">
        <div className="flex flex-col gap-3">
          <p className="text-fg-muted text-sm">
            Se manda al grupo y cada socio se asocia solo desde la app. Un código sin vencimiento ni
            tope de usos es una puerta abierta.
          </p>

          {(codigos.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="Todavía no generaste ningún código"
              description="Es la forma más rápida de sumar a todo el grupo."
              action={<Button onClick={() => setNuevoCodigo(true)}>Generar el primero</Button>}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {(codigos.data?.items ?? []).map((codigo) => (
                  <li key={codigo.publicId} className="flex flex-wrap items-center gap-3">
                    <code className="bg-surface-2 text-fg rounded px-2 py-1 text-sm font-semibold">
                      {codigo.code}
                    </code>
                    <span className="text-fg-muted text-sm">
                      {codigo.usedCount} de {codigo.maxUses} usos
                    </span>
                    <span className="text-fg-muted text-sm">
                      vence el {formatDate(Temporal.Instant.from(codigo.expiresAt), zona)}
                    </span>
                    {codigo.status === 'active' ? (
                      <Button
                        variant="secondary"
                        className="h-11"
                        onClick={() => setARevocar(codigo)}
                      >
                        <span aria-hidden="true">Revocar</span>
                        <span className="sr-only">Revocar {codigo.code}</span>
                      </Button>
                    ) : (
                      <Badge tone="neutral">Revocado</Badge>
                    )}
                  </li>
                ))}
              </ul>

              <div>
                <Button variant="secondary" className="h-11" onClick={() => setNuevoCodigo(true)}>
                  Generar otro
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {alta ? (
        <Dialog
          open={alta}
          onClose={() => setAlta(false)}
          title="Agregar un socio"
          description="Lo que carga el mostrador. El socio después vincula su cuenta con un código."
        >
          <form onSubmit={agregarSocio} className="flex flex-col gap-4">
            <FormField label="Nombre" required>
              <Input name="firstName" required minLength={2} maxLength={60} />
            </FormField>

            <FormField label="Apellido" required>
              <Input name="lastName" required minLength={2} maxLength={60} />
            </FormField>

            <FormField label="Teléfono">
              <Input name="phone" type="tel" />
            </FormField>

            <FormField label="Email">
              <Input name="email" type="email" />
            </FormField>

            <FormField
              label="Fecha de nacimiento"
              description="Si es menor, el servidor va a pedir los datos del tutor."
            >
              <Input name="birthDate" type="date" />
            </FormField>

            <FormField label="Sede" required>
              <Select
                name="venueId"
                required
                options={(sedes.data?.items ?? []).map((sede) => ({
                  value: sede.publicId,
                  label: sede.name,
                }))}
              />
            </FormField>

            {/*
              El error del servidor se muestra tal cual: la mayoría de edad la
              decide la API, que sabe qué día es hoy.
            */}
            {crearSocio.isError ? (
              <div role="alert" className="text-danger-600 text-sm">
                {mensajeDe(crearSocio.error)}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={crearSocio.isPending}>
                Agregar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAlta(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {nuevoCodigo ? (
        <Dialog
          open={nuevoCodigo}
          onClose={() => setNuevoCodigo(false)}
          title="Generar un código"
          description="El código lo genera el sistema: si lo eligiera el centro, dos centros elegirían el mismo."
        >
          <form onSubmit={generarCodigo} className="flex flex-col gap-4">
            <FormField label="Sede" required>
              <Select
                name="venueId"
                required
                options={(sedes.data?.items ?? []).map((sede) => ({
                  value: sede.publicId,
                  label: sede.name,
                }))}
              />
            </FormField>

            <FormField
              label="Cuántas personas pueden usarlo"
              required
              description="Un código filtrado sin tope se usa para siempre."
            >
              <Input name="maxUses" type="number" min={1} max={1000} defaultValue={50} required />
            </FormField>

            <FormField label="Vence el" required>
              <Input name="expiresAt" type="date" required />
            </FormField>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={generar.isPending}>
                Generar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setNuevoCodigo(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {aRevocar ? (
        <Dialog
          open={aRevocar !== null}
          onClose={() => setARevocar(null)}
          title={`Revocar ${aRevocar.code}`}
          dismissOnBackdrop={false}
          footer={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={revocar.isPending}
                onClick={() => revocar.mutate(aRevocar.publicId)}
              >
                Revocar
              </Button>
              <Button variant="secondary" onClick={() => setARevocar(null)}>
                No, volver
              </Button>
            </div>
          }
        >
          <p className="text-fg-muted text-sm">
            Deja de funcionar de inmediato, pero quienes ya lo usaron siguen siendo socios: revocar
            cierra la puerta, no echa a nadie.
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Centavos enteros a pesos. El dinero nunca es float (§3.1). */
function pesos(cents: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}
