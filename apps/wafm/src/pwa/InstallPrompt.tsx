import { useEffect, useState } from 'react';
import { Button, Dialog } from '@laplace/ui';
import {
  IOS_INSTALL_STEPS,
  installSupport,
  recordInstallAccepted,
  recordInstallDismissed,
  recordInstallPrompted,
  shouldOfferInstall,
  type BeforeInstallPromptEvent,
  type InstallSupport,
} from '@laplace/client';

/**
 * Ofrecimiento de instalar la app (§5.1.3).
 *
 * Dos caminos, porque hay dos mundos: en Chrome se dispara el prompt nativo, y
 * en iOS — donde `beforeinstallprompt` no existe — se muestran las
 * instrucciones. Sin esa bifurcacion, el boton no hace nada en Safari.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [support, setSupport] = useState<InstallSupport>('unsupported');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };

    globalThis.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => globalThis.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  useEffect(() => {
    const standalone =
      globalThis.matchMedia?.('(display-mode: standalone)').matches ??
      // iOS expone su propio flag y no soporta display-mode: standalone.
      (globalThis.navigator as { standalone?: boolean }).standalone === true;

    const detected = installSupport({
      userAgent: globalThis.navigator?.userAgent ?? '',
      standalone,
      hasPrompt: deferred !== null,
    });
    setSupport(detected);

    if (detected === 'installed' || detected === 'unsupported') return;
    if (!shouldOfferInstall(Date.now())) return;

    setOpen(true);
    recordInstallPrompted(Date.now());
  }, [deferred]);

  if (!open) return null;

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;

    if (outcome === 'accepted') recordInstallAccepted();
    else recordInstallDismissed(Date.now());

    setOpen(false);
  };

  const dismiss = () => {
    recordInstallDismissed(Date.now());
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onClose={dismiss}
      title="Instalá Laplace en tu teléfono"
      description="Se abre más rápido y funciona aunque no tengas señal."
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            Ahora no
          </Button>
          {support === 'prompt' ? <Button onClick={() => void install()}>Instalar</Button> : null}
        </>
      }
    >
      {support === 'ios-manual' ? (
        <ol className="text-fg-muted flex list-decimal flex-col gap-2 pl-5 text-sm">
          {IOS_INSTALL_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : (
        <p className="text-fg-muted text-sm">Tocá Instalar y confirmá en el aviso del navegador.</p>
      )}
    </Dialog>
  );
}
