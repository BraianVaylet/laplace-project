import type { ReactNode } from 'react';
import { cn } from '../cn.js';

/**
 * Los tres estados que la spec exige en todo listado y toda pantalla (§15 DoD):
 * carga, vacio y error. Estan aca para que ninguna pantalla tenga que
 * inventarlos, que es como terminan faltando.
 */

export interface SkeletonProps {
  className?: string;
  /** Cuantas filas dibujar. Un listado vacio y uno cargando no se ven igual. */
  rows?: number;
}

/**
 * Skeleton, **no spinner** (§6). Un spinner dice "esperá"; un skeleton dice
 * "esto va a ser una lista de cinco filas", que es informacion util y hace que
 * la espera se sienta mas corta.
 */
export function Skeleton({ className, rows = 1 }: SkeletonProps) {
  return (
    <div role="status" aria-label="Cargando" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn('bg-surface-3 h-11 w-full animate-pulse rounded-md', className)}
        />
      ))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  /**
   * La accion que resuelve el vacio. Es obligatoria a proposito: §6 dice que
   * los estados vacios con accion son el 80% del onboarding percibido, y uno
   * sin accion deja al usuario mirando una pantalla que no le dice que hacer.
   */
  action: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center',
        className,
      )}
    >
      {icon ? <div aria-hidden="true">{icon}</div> : null}
      <h3 className="text-fg text-base font-medium">{title}</h3>
      {description ? <p className="text-fg-muted max-w-prose text-sm">{description}</p> : null}
      <div className="mt-1">{action}</div>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  /** Que puede hacer el usuario. Sale del `action` del envelope de error §5.0. */
  action?: string;
  /** Codigo y requestId, para que pueda compartirlos con soporte (§5). */
  code?: string;
  requestId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = 'Algo salió mal',
  message,
  action,
  code,
  requestId,
  onRetry,
  retryLabel = 'Reintentar',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'border-danger-600 flex flex-col items-center gap-2 rounded-lg border p-6 text-center',
        className,
      )}
    >
      <h3 className="text-fg text-base font-medium">{title}</h3>
      <p className="text-fg-muted max-w-prose text-sm">{message}</p>
      {action ? <p className="text-fg text-sm">{action}</p> : null}

      {code ? (
        <p className="text-fg-muted mt-1 font-mono text-xs">
          {code}
          {requestId ? ` · ${requestId}` : ''}
        </p>
      ) : null}

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="focus-visible:focus-ring text-brand-400 mt-2 h-11 px-4 text-sm underline"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
