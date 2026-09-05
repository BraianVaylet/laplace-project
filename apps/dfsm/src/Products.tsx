import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, ProductType, Venue } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import {
  Badge,
  Button,
  Card,
  Checkbox,
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
 * El catálogo de lo que el centro vende (§2.1.17, F1-34).
 *
 * 🔴 **El formulario sigue al tipo.** Una membresía ilimitada no lleva
 * créditos, y ofrecer el campo invita a cargar una contradicción que después el
 * motor de reservas tiene que desambiguar. Las reglas son las mismas que valida
 * el schema compartido: acá no se duplican, se muestran.
 *
 * 🔴 **El precio se carga en pesos y viaja en centavos enteros** (§3.1).
 * 60.000,50 pesos son 6.000.050 centavos; guardarlos como `60000.5` arrastra el
 * error de punto flotante hasta la caja del centro.
 */
export interface ProductsProps {
  client?: ApiClient;
}

interface Reglas {
  label: string;
  credits: 'requerido' | 'fijo' | 'no';
  duration: 'requerido' | 'opcional' | 'no';
  limites: boolean;
  gratis: boolean;
}

/** Las mismas reglas por tipo de §2.1.17, del lado de la pantalla. */
const TIPOS: Record<ProductType, Reglas> = {
  class_pack: {
    label: 'Pack de clases',
    credits: 'requerido',
    duration: 'requerido',
    limites: false,
    gratis: false,
  },
  membership_unlimited: {
    label: 'Membresía ilimitada',
    credits: 'no',
    duration: 'requerido',
    limites: false,
    gratis: false,
  },
  membership_limited: {
    label: 'Membresía con tope',
    credits: 'no',
    duration: 'requerido',
    limites: true,
    gratis: false,
  },
  drop_in: {
    label: 'Clase suelta',
    credits: 'fijo',
    duration: 'opcional',
    limites: false,
    gratis: false,
  },
  trial: {
    label: 'Clase de prueba',
    credits: 'fijo',
    duration: 'opcional',
    limites: false,
    gratis: true,
  },
  personal_training: {
    label: 'Entrenamiento personal',
    credits: 'requerido',
    duration: 'requerido',
    limites: false,
    gratis: false,
  },
  event: { label: 'Evento', credits: 'no', duration: 'opcional', limites: false, gratis: false },
};

const OPCIONES_TIPO = Object.entries(TIPOS).map(([value, { label }]) => ({ value, label }));

export function Products({ client = api }: ProductsProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<ProductType>('class_pack');
  const [aArchivar, setAArchivar] = useState<Product | null>(null);

  const productos = useQuery({
    queryKey: ['products'],
    queryFn: () => client.get<{ items: Product[] }>('/products'),
  });

  const sedes = useQuery({
    queryKey: ['venues'],
    queryFn: () => client.get<{ items: Venue[] }>('/venues'),
  });

  const crear = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.post<Product>('/products', datos),
    onSuccess: async (producto) => {
      setAbierto(false);
      toast.show({ tone: 'success', message: `Publicamos ${producto.name}.` });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      // El asistente de primeros pasos cuenta productos.
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const archivar = useMutation({
    mutationFn: (publicId: string) => client.post(`/products/${publicId}/archive`, {}),
    onSuccess: async () => {
      setAArchivar(null);
      toast.show({ tone: 'success', message: 'Lo sacamos de la venta.' });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  if (productos.isPending) return <Skeleton className="h-64" label="Cargando el catálogo" />;

  if (productos.isError) {
    return (
      <ErrorState
        title="No pudimos traer el catálogo"
        message={mensajeDe(productos.error)}
        onRetry={() => void productos.refetch()}
        {...accionDe(productos.error)}
      />
    );
  }

  const reglas = TIPOS[tipo];

  const enviar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const texto = (campo: string) => String(datos.get(campo) ?? '').trim();
    const entero = (campo: string) => {
      const valor = texto(campo);

      return valor === '' ? undefined : Number(valor);
    };

    crear.mutate({
      name: texto('name'),
      type: tipo,
      // 🔴 De pesos a centavos enteros. `Math.round` y no `Math.trunc`: 0.1 + 0.2
      // en punto flotante es 0.30000000000000004, y truncar perdería el centavo.
      priceCents: reglas.gratis ? 0 : Math.round(Number(texto('price') || 0) * 100),
      ...(reglas.credits === 'fijo' ? { credits: 1 } : {}),
      ...(reglas.credits === 'requerido' ? { credits: entero('credits') } : {}),
      ...(reglas.duration === 'no' ? {} : { durationDays: entero('durationDays') }),
      ...(reglas.limites
        ? {
            ...(entero('weeklyLimit') === undefined ? {} : { weeklyLimit: entero('weeklyLimit') }),
            ...(entero('monthlyLimit') === undefined
              ? {}
              : { monthlyLimit: entero('monthlyLimit') }),
          }
        : {}),
      venueIds: datos.getAll('venueIds').map(String),
      visibleInApp: datos.get('visibleInApp') === 'on',
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-fg text-xl font-semibold">Productos</h1>
        {productos.data.items.length > 0 ? (
          <Button onClick={() => setAbierto(true)}>Crear producto</Button>
        ) : null}
      </header>

      {productos.data.items.length === 0 ? (
        <EmptyState
          title="Todavía no tenés nada para vender"
          description="Sin un producto no hay contrato, y sin contrato nadie puede reservar."
          action={<Button onClick={() => setAbierto(true)}>Crear el primero</Button>}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {productos.data.items.map((producto) => (
            <li key={producto.publicId}>
              <Card title={producto.name}>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-fg text-lg font-semibold">
                      {pesos(producto.priceCents)}
                    </span>
                    <Badge tone={producto.active ? 'success' : 'neutral'}>
                      {producto.active ? TIPOS[producto.type].label : 'Archivado'}
                    </Badge>
                    {producto.visibleInApp ? null : <Badge tone="neutral">Solo mostrador</Badge>}
                  </div>

                  <p className="text-fg-muted text-sm">{queTrae(producto)}</p>

                  {producto.soldCount > 0 ? (
                    <p className="text-fg-muted text-sm">{producto.soldCount} vendidos</p>
                  ) : null}

                  {producto.active ? (
                    <div>
                      <Button
                        variant="secondary"
                        className="h-11"
                        onClick={() => setAArchivar(producto)}
                      >
                        <span aria-hidden="true">Archivar</span>
                        <span className="sr-only">Archivar {producto.name}</span>
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Crear un producto"
        description="El tipo decide cómo se consume. No se puede cambiar después."
      >
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <FormField
            label="Tipo"
            required
            description="Cambia qué se te pide más abajo: un ilimitado no lleva créditos."
          >
            <Select
              name="type"
              options={OPCIONES_TIPO}
              value={tipo}
              onChange={(event) => setTipo(event.currentTarget.value as ProductType)}
            />
          </FormField>

          <FormField label="Nombre" required>
            <Input name="name" required minLength={2} maxLength={80} />
          </FormField>

          <FormField
            label="Precio"
            required={!reglas.gratis}
            description={
              reglas.gratis
                ? 'La clase de prueba es gratuita: cobrarla la convierte en una clase suelta.'
                : 'En pesos. Se guarda en centavos enteros.'
            }
          >
            <Input
              name="price"
              type="number"
              min={0}
              step="0.01"
              defaultValue={reglas.gratis ? 0 : ''}
              disabled={reglas.gratis}
              required={!reglas.gratis}
            />
          </FormField>

          {reglas.credits === 'requerido' ? (
            <FormField label="Cuántas clases trae" required>
              <Input name="credits" type="number" min={1} max={500} required />
            </FormField>
          ) : null}

          {reglas.credits === 'fijo' ? (
            <p className="text-fg-muted text-sm">Vale exactamente 1 clase.</p>
          ) : null}

          {reglas.duration === 'no' ? null : (
            <FormField
              label={
                reglas.label.startsWith('Membresía')
                  ? 'Período de la membresía'
                  : 'En cuántos días vence'
              }
              required={reglas.duration === 'requerido'}
              description="En días desde la compra."
            >
              <Input
                name="durationDays"
                type="number"
                min={1}
                max={3650}
                required={reglas.duration === 'requerido'}
              />
            </FormField>
          )}

          {reglas.limites ? (
            <>
              <p className="text-fg-muted text-sm">
                Cargá al menos uno de los dos: sin tope es una membresía ilimitada con otro nombre.
              </p>
              <FormField label="Tope semanal">
                <Input name="weeklyLimit" type="number" min={1} max={50} />
              </FormField>
              <FormField label="Tope mensual">
                <Input name="monthlyLimit" type="number" min={1} max={200} />
              </FormField>
            </>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-fg text-sm font-medium">Sedes donde vale</legend>
            {(sedes.data?.items ?? []).map((sede) => (
              <Checkbox
                key={sede.publicId}
                name="venueIds"
                value={sede.publicId}
                label={sede.name}
                defaultChecked={sedes.data?.items.length === 1}
              />
            ))}
          </fieldset>

          <Checkbox
            name="visibleInApp"
            label="Mostrarlo en la app del socio"
            description="Apagalo si solo se vende en el mostrador."
            defaultChecked
          />

          {crear.isError ? (
            <div role="alert" className="text-danger-600 text-sm">
              {mensajeDe(crear.error)}
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

      <Dialog
        open={aArchivar !== null}
        onClose={() => setAArchivar(null)}
        title={aArchivar ? `Archivar ${aArchivar.name}` : 'Archivar'}
        dismissOnBackdrop={false}
        footer={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={archivar.isPending}
              onClick={() => aArchivar && archivar.mutate(aArchivar.publicId)}
            >
              Archivar
            </Button>
            <Button variant="secondary" onClick={() => setAArchivar(null)}>
              No, volver
            </Button>
          </div>
        }
      >
        <p className="text-fg-muted text-sm">
          Deja de venderse, pero quienes ya lo compraron siguen entrenando con lo que pagaron: sus
          contratos no se tocan.
        </p>
      </Dialog>
    </div>
  );
}

/** "8 clases · vence en 30 días", o lo que corresponda al tipo. */
function queTrae(producto: Product): string {
  const partes: string[] = [];

  if (producto.credits !== undefined) {
    partes.push(`${producto.credits} ${producto.credits === 1 ? 'clase' : 'clases'}`);
  }
  if (producto.weeklyLimit !== undefined) partes.push(`${producto.weeklyLimit} por semana`);
  if (producto.monthlyLimit !== undefined) partes.push(`${producto.monthlyLimit} por mes`);
  if (producto.durationDays !== undefined) partes.push(`vence en ${producto.durationDays} días`);

  return partes.length > 0 ? partes.join(' · ') : 'Sin tope ni vencimiento';
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
