import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.js';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-3 text-fg',
  brand: 'bg-brand-600 text-white',
  success: 'bg-success-600 text-white',
  warning: 'bg-warning-600 text-black',
  danger: 'bg-danger-600 text-white',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/**
 * Etiqueta de estado. El color NUNCA es la unica señal: el texto dice el estado
 * igual, porque el 8% de los hombres no distingue rojo de verde (§6, WCAG).
 */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  /** Acciones del encabezado: cobrar, editar, archivar. */
  actions?: ReactNode;
}

export function Card({ title, actions, className, children, ...props }: CardProps) {
  return (
    <section
      className={cn('bg-surface border-border rounded-lg border p-4', className)}
      {...props}
    >
      {title || actions ? (
        /*
         * Un `div`, no un `<header>`: dentro de un `<section>` el header no es
         * un `banner` segun la spec de HTML, pero mas de una implementacion de
         * roles lo trata como si lo fuera y entonces la pagina termina con dos
         * banners. El `<h3>` ya carga el significado.
         */
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h3 className="text-fg text-sm font-semibold">{title}</h3> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
