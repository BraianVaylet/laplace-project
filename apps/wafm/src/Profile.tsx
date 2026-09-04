import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MyProfile } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import { Button, Card, ErrorState, FormField, Input, Skeleton, useToast } from '@laplace/ui';
import { api } from './api.js';

/**
 * Mi perfil (§2.1.2, §9.2).
 *
 * Tres cosas: mis datos, mi foto y **lo que puedo hacer con mis datos**. Lo
 * último no es un extra legal escondido en los términos: el derecho de acceso y
 * el de supresión son de la persona, y esconderlos detrás de un mail a soporte
 * es la forma habitual de no cumplirlos.
 */
export interface ProfileProps {
  client?: ApiClient;
}

export function Profile({ client = api }: ProfileProps = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const archivo = useRef<HTMLInputElement>(null);
  const [bajaPedida, setBajaPedida] = useState<string | null>(null);

  const perfil = useQuery({
    queryKey: ['my', 'profile'],
    queryFn: () => client.get<MyProfile>('/my/profile'),
  });

  const guardar = useMutation({
    mutationFn: (datos: Record<string, unknown>) => client.patch('/my/profile', datos),
    onSuccess: async () => {
      toast.show({ tone: 'success', message: 'Guardamos tus datos.' });
      await queryClient.invalidateQueries({ queryKey: ['my', 'profile'] });
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const subirFoto = useMutation({
    /*
     * El archivo va tal cual: `fetch` lo manda en streaming, sin cargar la foto
     * entera en memoria. El servidor mira los bytes para saber qué formato es —
     * el nombre y el `Content-Type` los escribe el navegador de quien sube, así
     * que no prueban nada.
     */
    mutationFn: (file: File) => client.request('/my/avatar', { method: 'POST', body: file }),
    onSuccess: async () => {
      toast.show({ tone: 'success', message: 'Listo, cambiamos tu foto.' });
      await queryClient.invalidateQueries({ queryKey: ['my', 'profile'] });
    },
    onError: (error: unknown) =>
      toast.show({ tone: 'danger', message: mensajeDe(error), ...accionDe(error) }),
  });

  const exportar = useMutation({
    mutationFn: () => client.get<unknown>('/my/data'),
    onSuccess: (datos) => {
      // Se le entrega al titular ahí mismo: pedir los datos y que lleguen
      // "en unos días" no es entregar nada (§9.2).
      const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'mis-datos-laplace.json';
      enlace.click();
      URL.revokeObjectURL(url);
    },
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  const pedirBaja = useMutation({
    mutationFn: () => client.post<{ purgeAfter: string }>('/my/deletion-request', {}),
    onSuccess: (resultado) => setBajaPedida(resultado.purgeAfter),
    onError: (error: unknown) => toast.show({ tone: 'danger', message: mensajeDe(error) }),
  });

  if (perfil.isPending) {
    return <Skeleton className="h-64" label="Cargando tu perfil" />;
  }

  if (perfil.isError) {
    return (
      <ErrorState
        title="No pudimos traer tu perfil"
        message={mensajeDe(perfil.error)}
        onRetry={() => void perfil.refetch()}
        {...accionDe(perfil.error)}
      />
    );
  }

  const enviar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;

    guardar.mutate({
      ...(datos['phone'] ? { phone: datos['phone'] } : {}),
      ...(datos['contactoNombre'] && datos['contactoTelefono']
        ? {
            emergencyContact: {
              fullName: datos['contactoNombre'],
              phone: datos['contactoTelefono'],
            },
          }
        : {}),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-fg text-xl font-semibold">Mi perfil</h1>

      <Card title="Tu foto">
        <div className="flex items-center gap-4">
          {perfil.data.avatarUrl ? (
            <img
              src={perfil.data.avatarUrl}
              alt=""
              className="border-border size-16 rounded-full border object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="bg-surface-2 border-border flex size-16 items-center justify-center rounded-full border text-xl"
            >
              {perfil.data.fullName.slice(0, 1)}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <input
              ref={archivo}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="Elegir una foto de perfil"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) subirFoto.mutate(file);
              }}
            />
            <Button
              variant="secondary"
              className="h-11"
              disabled={subirFoto.isPending}
              onClick={() => archivo.current?.click()}
            >
              {subirFoto.isPending ? 'Subiendo…' : 'Cambiar la foto'}
            </Button>
            <p className="text-fg-muted text-sm">JPG, PNG o WebP, hasta 2 MB.</p>
          </div>
        </div>
      </Card>

      <Card title="Tus datos">
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <FormField label="Tu nombre" description="Lo cambia el centro, no vos.">
            <Input defaultValue={perfil.data.fullName} disabled />
          </FormField>

          <FormField label="Tu teléfono">
            <Input name="phone" type="tel" defaultValue={perfil.data.phone ?? ''} />
          </FormField>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-fg text-sm font-medium">
              Contacto de emergencia
              <span className="text-fg-muted block font-normal">
                A quién llamamos si te pasa algo entrenando.
              </span>
            </legend>

            <FormField label="Nombre">
              <Input
                name="contactoNombre"
                defaultValue={perfil.data.emergencyContact?.fullName ?? ''}
              />
            </FormField>
            <FormField label="Teléfono">
              <Input
                name="contactoTelefono"
                type="tel"
                defaultValue={perfil.data.emergencyContact?.phone ?? ''}
              />
            </FormField>
          </fieldset>

          <div>
            <Button type="submit" disabled={guardar.isPending}>
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Tus datos son tuyos">
        <div className="flex flex-col gap-3">
          <p className="text-fg-muted text-sm">
            Podés llevarte todo lo que guardamos de vos, o pedir que lo borremos. Es tu derecho por
            la Ley 25.326.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="h-11"
              disabled={exportar.isPending}
              onClick={() => exportar.mutate()}
            >
              {exportar.isPending ? 'Preparando…' : 'Descargar mis datos'}
            </Button>

            <Button
              variant="secondary"
              className="h-11"
              disabled={pedirBaja.isPending || bajaPedida !== null}
              onClick={() => pedirBaja.mutate()}
            >
              Pedir la baja
            </Button>
          </div>

          {bajaPedida ? (
            <p role="status" className="text-fg-muted text-sm">
              Registramos tu pedido. Tus datos se conservan hasta el {bajaPedida.slice(0, 10)} por
              las obligaciones del centro sobre lo que firmaste y pagaste, y después se borran.
            </p>
          ) : null}
        </div>
      </Card>
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
