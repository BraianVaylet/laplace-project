import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog } from '@laplace/ui';
import { UPDATE_ESCAPE_MS, createUpdateController, type UpdateState } from '@laplace/client';

/**
 * Popup de actualizacion **bloqueante** (§5.1.3), con el escape a los 30
 * segundos que evita que un service worker roto deje al socio encerrado.
 */
export function UpdateGate({ onActivate }: { onActivate?: () => void | Promise<void> }) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });

  const controller = useMemo(
    () =>
      createUpdateController({
        activate: () => {
          if (onActivate) return onActivate();
          // El registro del SW escucha este evento y llama a updateSW(true).
          globalThis.dispatchEvent(new Event('laplace:sw-apply'));
        },
        onChange: setState,
      }),
    [onActivate],
  );

  useEffect(() => {
    const onUpdate = () => controller.onAvailable();
    globalThis.addEventListener('laplace:sw-update', onUpdate);
    return () => globalThis.removeEventListener('laplace:sw-update', onUpdate);
  }, [controller]);

  useEffect(() => {
    if (state.status !== 'updating') return;

    // Se chequea cada segundo en vez de un solo timeout: asi el estado sigue
    // siendo funcion del reloj y no de que un timer se haya limpiado bien.
    const timer = setInterval(() => controller.tick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.status, controller]);

  if (state.status === 'idle') return null;

  const stuck = state.status === 'stuck';

  return (
    <Dialog
      open
      onClose={() => (controller.canDismiss() ? controller.dismiss() : undefined)}
      dismissOnBackdrop={false}
      title="Hay una versión nueva"
      description={
        stuck
          ? 'La actualización está tardando más de lo normal.'
          : 'Actualizá para seguir usando la app.'
      }
      footer={
        stuck ? (
          <Button variant="secondary" onClick={() => controller.dismiss()}>
            Seguir sin actualizar
          </Button>
        ) : (
          <Button
            onClick={() => controller.apply(Date.now())}
            disabled={state.status === 'updating'}
          >
            {state.status === 'updating' ? 'Actualizando…' : 'Actualizar'}
          </Button>
        )
      }
    >
      <p className="text-fg-muted text-sm">
        {stuck
          ? `Pasaron ${UPDATE_ESCAPE_MS / 1000} segundos y no terminó. Podés seguir usando la versión actual y reintentar más tarde.`
          : 'Tarda unos segundos.'}
      </p>
    </Dialog>
  );
}
