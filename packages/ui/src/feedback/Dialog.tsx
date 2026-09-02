import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../cn.js';

/**
 * Dialogo modal sobre el `<dialog>` **nativo**.
 *
 * Es una decision deliberada: `showModal()` da foco atrapado, cierre con
 * Escape, fondo inerte y restauracion del foco al cerrar — las cuatro cosas que
 * un modal hecho a mano suele resolver mal, y sin una sola dependencia. Lo unico
 * que hay que agregar arriba es el cierre al hacer clic en el backdrop.
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Un flujo destructivo no se cierra por accidente al tocar afuera. */
  dismissOnBackdrop?: boolean;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissOnBackdrop = true,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal?.();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // `cancel` es Escape. Se deja que el navegador cierre y se avisa al padre,
    // para que el estado no quede diciendo "abierto" con el modal ya cerrado.
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      {...(description ? { 'aria-describedby': 'dialog-description' } : {})}
      onClick={(event) => {
        // El click sobre el backdrop llega con el <dialog> como target.
        if (dismissOnBackdrop && event.target === ref.current) onClose();
      }}
      className={cn(
        'bg-surface text-fg border-border m-auto w-[min(32rem,calc(100vw-2rem))]',
        'rounded-lg border p-6 shadow-xl',
        className,
      )}
    >
      <h2 id="dialog-title" className="text-fg text-lg font-semibold">
        {title}
      </h2>

      {description ? (
        <p id="dialog-description" className="text-fg-muted mt-1 text-sm">
          {description}
        </p>
      ) : null}

      <div className="mt-4">{children}</div>

      {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
    </dialog>
  );
}
