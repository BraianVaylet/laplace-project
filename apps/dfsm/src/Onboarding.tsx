import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OnboardingProgress, OnboardingStep } from '@laplace/schemas';
import type { ApiClient } from '@laplace/client';
import { Badge, Button, Card } from '@laplace/ui';
import { api } from './api.js';

/**
 * El asistente de primeros pasos (§2.1.3).
 *
 * La métrica de §2.0 es **time-to-first-class < 30 min**: el onboarding es
 * donde se pierde el SaaS. Por eso vive arriba del tablero del home y no en una
 * pantalla aparte — el que se registró un martes a las 21:00 no va a buscar un
 * menú, va a mirar lo que tiene delante.
 *
 * 🔴 **Saltear no marca hecho.** El paso salteado sale del camino pero sigue
 * pendiente: una barra que llega al 100% con el centro vacío es peor que no
 * tener barra, porque el SMU se entera cuando un socio abre la app y no hay
 * nada.
 *
 * Cuando termina, desaparece. Dejar el checklist arriba para siempre le roba
 * el lugar al tablero del día, que es lo que se mira todas las mañanas.
 */
export interface OnboardingProps {
  client?: ApiClient;
}

export function Onboarding({ client = api }: OnboardingProps = {}) {
  const queryClient = useQueryClient();

  const progreso = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => client.get<OnboardingProgress>('/subscription/onboarding'),
    retry: false,
  });

  const cambiar = useMutation({
    mutationFn: ({ stepId, accion }: { stepId: string; accion: 'skip' | 'resume' }) =>
      client.post(`/subscription/onboarding/${stepId}/${accion}`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  /*
   * Sin estado de carga y sin estado de error: este bloque es un agregado
   * arriba del tablero, y un asistente que falla no puede tapar lo que el
   * centro necesita ver hoy. Se calla y el home sigue.
   */
  if (!progreso.data || progreso.data.completedAt) return null;

  const { steps, percent, doneCount, totalCount } = progreso.data;

  return (
    <Card title="Primeros pasos">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-fg-muted text-sm">
              Con esto tu centro queda abierto. Lo podés dejar a medias y seguir después.
            </p>
            <p className="text-fg text-sm font-medium">
              {doneCount} de {totalCount} pasos
            </p>
          </div>

          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progreso de los primeros pasos"
            className="bg-surface-2 border-border h-2 w-full overflow-hidden rounded-full border"
          >
            <div
              className="bg-accent h-full rounded-full transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <ol className="flex flex-col gap-2">
          {steps.map((paso) => (
            <li
              key={paso.id}
              className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex min-w-48 flex-1 flex-col">
                <span className="text-fg text-sm font-medium">{paso.title}</span>
                <span className="text-fg-muted text-sm">{descripcionDe(paso)}</span>
              </div>

              <Estado paso={paso} />

              <div className="flex gap-2">
                {/*
                  Ancla y no `Link`: el asistente manda a las pantallas del menú
                  del DFSM, las mismas que usa el `AppShell`. Una pantalla
                  propia del asistente sería una segunda alta de sede que
                  mantener.
                */}
                {paso.done || paso.blocked ? null : (
                  <a
                    href={paso.href}
                    className="bg-surface-2 text-fg hover:bg-surface-3 focus-visible:outline-brand-500 inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {paso.skipped ? 'Hacerlo ahora' : 'Empezar'}
                  </a>
                )}

                {paso.done ? null : (
                  <Button
                    variant="ghost"
                    className="h-11"
                    disabled={cambiar.isPending}
                    onClick={() =>
                      cambiar.mutate({
                        stepId: paso.id,
                        accion: paso.skipped ? 'resume' : 'skip',
                      })
                    }
                  >
                    <span aria-hidden="true">
                      {paso.skipped ? 'Retomar' : 'Dejar para después'}
                    </span>
                    {/* El nombre del botón dice de qué paso habla: cinco
                        botones iguales no le sirven a quien usa lector. */}
                    <span className="sr-only">
                      {paso.skipped ? 'Retomar' : 'Dejar para después'} {paso.title}
                    </span>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/**
 * El estado en palabras, no solo en color: quien no distingue verde de gris
 * necesita leerlo (DoD §15).
 */
function Estado({ paso }: { paso: OnboardingStep }) {
  if (paso.done) return <Badge tone="success">Listo</Badge>;
  if (paso.blocked) return <Badge tone="neutral">Trabado</Badge>;
  if (paso.skipped) return <Badge tone="warning">Lo dejaste para después</Badge>;

  return <Badge tone="neutral">{paso.required ? 'Falta' : 'Opcional'}</Badge>;
}

/** El paso trabado explica por qué, en vez de dejar tocar y fallar con un 422. */
function descripcionDe(paso: OnboardingStep): string {
  return paso.blocked ? 'Primero necesitás una sede' : paso.description;
}
