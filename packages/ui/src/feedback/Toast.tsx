import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../cn.js';

export type ToastTone = 'info' | 'success' | 'danger';

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  /** Codigo de error de `docs/errors.md`, para que el usuario pueda reportarlo. */
  code?: string;
  requestId?: string;
}

interface ToastApi {
  show(toast: Omit<Toast, 'id'>): string;
  dismiss(id: string): void;
  toasts: readonly Toast[];
}

const Context = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(Context);
  if (!api) throw new Error('useToast necesita estar dentro de <ToastProvider>');
  return api;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${++counter}`;
    setToasts((current) => [...current, { ...toast, id }]);
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss, toasts }), [show, dismiss, toasts]);

  return (
    <Context.Provider value={api}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </Context.Provider>
  );
}

const TONES: Record<ToastTone, string> = {
  info: 'border-border bg-surface-2',
  success: 'border-success-600 bg-surface-2',
  danger: 'border-danger-600 bg-surface-2',
};

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: readonly Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    /*
     * `aria-live="polite"` para que el lector anuncie el mensaje sin
     * interrumpir lo que este leyendo. Los errores usan `assertive` en su
     * propio nodo, mas abajo.
     */
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto w-full max-w-md rounded-md border p-4 shadow-lg',
            TONES[toast.tone],
          )}
        >
          <p className="text-fg text-sm">{toast.message}</p>

          {/*
            El codigo y el requestId van visibles a proposito (spec §5): es lo
            que el usuario le pasa a soporte para que sepan que le paso.
          */}
          {toast.code ? (
            <p className="text-fg-muted mt-1 font-mono text-xs">
              {toast.code}
              {toast.requestId ? ` · ${toast.requestId}` : ''}
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="text-fg-muted hover:text-fg focus-visible:focus-ring absolute top-2 right-2 size-11 rounded"
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
