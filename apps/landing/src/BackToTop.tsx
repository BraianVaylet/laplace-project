import { useEffect, useState } from 'react';

/**
 * El botón de volver arriba (§5.1.4: "visible en todo momento").
 *
 * Aparece recién después de bajar una pantalla: arriba de todo no tiene nada
 * que hacer y solo tapa contenido en un teléfono.
 *
 * 🔴 El scroll suave se pide con `behavior: 'smooth'` **pero respeta a quien
 * pidió que no se mueva nada**: `prefers-reduced-motion` existe porque a
 * algunas personas el movimiento les provoca mareo, y una animación decorativa
 * no vale eso.
 */
const APARECE_DESPUES_DE = 400;

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const alScrollear = () => setVisible(window.scrollY > APARECE_DESPUES_DE);

    alScrollear();
    window.addEventListener('scroll', alScrollear, { passive: true });

    return () => window.removeEventListener('scroll', alScrollear);
  }, []);

  if (!visible) return null;

  const subir = () => {
    const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    window.scrollTo({ top: 0, behavior: sinMovimiento ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      onClick={subir}
      aria-label="Volver al inicio de la página"
      className="border-border bg-surface hover:bg-surface-2 focus-visible:focus-ring fixed bottom-4 right-4 z-20 flex size-11 items-center justify-center rounded-full border shadow-lg"
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}
