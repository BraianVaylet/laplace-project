import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Plan } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import { Button, Card, FormField, Input, Select } from '@laplace/ui';
import { api } from '../api.js';

/**
 * El alta self-service (§2.1.3, ADR-004 — F1-38).
 *
 * Es la puerta de entrada del producto: hasta acá la API existía desde F1-25 y
 * el CTA de precios no llevaba a ningún lado.
 *
 * 🔴 **Son dos llamadas y una sola cosa para quien la hace**: primero la cuenta,
 * después el centro. Si la segunda falla queda una cuenta sin centro —alguien
 * que se registró y no es cliente de nada—, y eso se dice. Mandarlo de vuelta
 * al formulario lo haría chocar contra "ese email ya existe" sin entender por
 * qué.
 *
 * **Sin tarjeta** (ADR-004): pedirla acá es la forma más rápida de perder a
 * quien quería probar.
 */
export interface SignUpProps {
  client?: ApiClient;
  /** El plan que eligió en la tabla de precios, si vino de ahí. */
  planPreseleccionado?: string;
}

interface Datos {
  name: string;
  email: string;
  password: string;
  centerName: string;
  planId: string;
}

export function SignUp({ client = api, planPreseleccionado }: SignUpProps = {}) {
  const [cuentaCreada, setCuentaCreada] = useState(false);
  /*
   * Controlado: las opciones llegan después del primer render, y un
   * `defaultValue` sobre un select vacío lo deja pegado a la primera opción que
   * aparezca — o sea, al plan más barato, que no es el que eligió.
   */
  const [planId, setPlanId] = useState(planPreseleccionado ?? planDeLaUrl());
  const [listo, setListo] = useState<{ centerName: string; email: string } | null>(null);

  const planes = useQuery({
    queryKey: ['plans'],
    queryFn: () => client.get<Plan[]>('/plans'),
  });

  const alta = useMutation({
    mutationFn: async (datos: Datos) => {
      /*
       * El registro deja la sesión abierta, que es lo que la segunda llamada
       * necesita: `POST /subscribers` saca el dueño de la sesión, nunca del
       * cuerpo.
       */
      if (!cuentaCreada) {
        await client.post('/auth/sign-up/email', {
          name: datos.name,
          email: datos.email,
          password: datos.password,
        });
        setCuentaCreada(true);
      }

      const centro = await client.post<{ organizationId: string }>('/subscribers', {
        centerName: datos.centerName,
        planId: datos.planId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      /*
       * 🔴 Y se deja el centro **activo** en la sesión. Sin esto, quien se
       * acaba de registrar entra al DFSM sin ningún centro seleccionado: la
       * API le contesta 403 a todo y ve una pantalla vacía justo en el minuto
       * en que decidió probar el producto.
       */
      await client.post('/auth/organization/set-active', {
        organizationId: centro.organizationId,
      });

      return { centerName: datos.centerName, email: datos.email };
    },
    onSuccess: (resultado) => setListo(resultado),
  });

  if (listo) {
    return (
      <section className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-12">
        <h1 className="text-fg text-2xl font-semibold">Listo, {listo.centerName} ya existe</h1>
        <p className="text-fg-muted">
          Tenés 14 días de prueba. Entrá con <strong>{listo.email}</strong> y el asistente te va a
          llevar por los primeros pasos: cargar tu sede, publicar tu primera clase y armar lo que
          vendés.
        </p>
        <div>
          <a
            href="http://localhost:5174/"
            className="bg-brand-600 focus-visible:outline-brand-500 inline-flex h-11 items-center rounded-md px-6 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Ir a mi centro
          </a>
        </div>
      </section>
    );
  }

  const enviar = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const datos = Object.fromEntries(new FormData(event.currentTarget)) as unknown as Datos;

    alta.mutate(datos);
  };

  return (
    <section className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-fg text-2xl font-semibold">Probá Laplace 14 días</h1>
        <p className="text-fg-muted">
          Sin tarjeta y sin llamada de ventas. Cargás tu centro y empezás; si no te sirve, no hacés
          nada.
        </p>
      </header>

      <Card title="Tu centro">
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <FormField label="Tu nombre" required>
            <Input name="name" required minLength={2} maxLength={60} autoComplete="name" />
          </FormField>

          <FormField label="Tu email" required description="Con este vas a entrar.">
            <Input name="email" type="email" required autoComplete="email" />
          </FormField>

          <FormField
            label="Elegí una clave"
            required
            description="Tiene que tener al menos 8 caracteres."
          >
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </FormField>

          <FormField
            label="Nombre de tu centro"
            required
            description="Es el que van a ver tus socios."
          >
            <Input name="centerName" required minLength={2} maxLength={80} />
          </FormField>

          <FormField label="Plan" description="Lo podés cambiar cuando quieras.">
            <Select
              name="planId"
              value={planId}
              onChange={(event) => setPlanId(event.currentTarget.value)}
              options={(planes.data ?? []).map((plan) => ({
                value: plan.planId,
                label: `${plan.name} — ${pesos(plan.priceCents)} por mes`,
              }))}
            />
          </FormField>

          {alta.isError ? (
            <div role="alert" className="flex flex-col gap-1 text-sm">
              <span className="text-danger-600">{mensajeDe(alta.error)}</span>
              {alta.error instanceof ApiRequestError && alta.error.action ? (
                <span className="text-fg-muted">{alta.error.action}</span>
              ) : null}
              {/*
                🔴 Si la cuenta se creó y el centro no, hay que decirlo: si no,
                al reintentar choca contra "ese email ya existe" sin entender
                por qué.
              */}
              {cuentaCreada ? (
                <span className="text-fg-muted">
                  Tu cuenta ya está creada: corregí el nombre del centro y volvé a intentar, no hace
                  falta registrarte de nuevo.
                </span>
              ) : null}
            </div>
          ) : null}

          <div>
            <Button type="submit" size="lg" disabled={alta.isPending}>
              {alta.isPending ? 'Creando…' : 'Crear mi centro'}
            </Button>
          </div>

          <p className="text-fg-muted text-sm">
            Al crear tu centro aceptás los <a href="/terminos">términos</a> y la{' '}
            <a href="/privacidad">política de privacidad</a>.
          </p>
        </form>
      </Card>
    </section>
  );
}

/**
 * El plan que venía en `?plan=` de la tabla de precios.
 *
 * Se lee del navegador y no de un loader porque la página se **prerenderiza**:
 * en el build no hay URL, y el HTML servido es el mismo para todos. Por eso el
 * default vive acá y no en el prerender.
 */
function planDeLaUrl(): string {
  if (typeof window === 'undefined') return 'pro';

  const elegido = new URLSearchParams(window.location.search).get('plan');

  return elegido && ['basic', 'pro', 'max'].includes(elegido) ? elegido : 'pro';
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
