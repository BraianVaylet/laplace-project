import type { ReactNode } from 'react';
import { cn } from '../cn.js';
import { ThemeToggle } from './AppShell.js';
import type { NavItem } from './AppShell.js';

/**
 * El esqueleto de la WAFM (§5.1.3).
 *
 * **Bottom nav en mobile, barra superior desde 768 px.** La spec v1 pedia barra
 * superior; el `[+]` de §5.1.3 recomienda revisarlo porque el pulgar no llega
 * arriba en un telefono grande. Se cumplen las dos: abajo en mobile, arriba en
 * pantallas donde el alcance no es problema.
 */
export interface MobileShellProps {
  brand: ReactNode;
  nav: readonly NavItem[];
  activeNavId?: string;
  /** Selector de centro, cuando el socio entrena en mas de uno. */
  headerExtra?: ReactNode;
  children: ReactNode;
  renderLink?: (item: NavItem, className: string, active: boolean) => ReactNode;
}

export function MobileShell({
  brand,
  nav,
  activeNavId,
  headerExtra,
  children,
  renderLink,
}: MobileShellProps) {
  const defaultLink = (item: NavItem, className: string, active: boolean) => (
    <a key={item.id} href={item.href} className={className} aria-current={active ? 'page' : undefined}>
      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
      <span>{item.label}</span>
    </a>
  );
  const link = renderLink ?? defaultLink;

  const itemClass = (active: boolean, layout: 'bottom' | 'top') =>
    cn(
      'focus-visible:focus-ring flex items-center justify-center gap-1 rounded-md text-xs',
      layout === 'bottom' ? 'min-h-11 flex-1 flex-col py-1' : 'h-11 px-3 text-sm',
      active ? 'text-fg font-medium' : 'text-fg-muted',
    );

  return (
    <div className="bg-bg text-fg flex min-h-dvh flex-col">
      <header className="border-border bg-surface flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="font-semibold">{brand}</div>

        {/* Barra superior solo desde tablet: en mobile la navegacion va abajo. */}
        <nav aria-label="Navegación principal" className="ml-4 hidden gap-1 md:flex">
          {nav.map((item) => link(item, itemClass(item.id === activeNavId, 'top'), item.id === activeNavId))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {headerExtra}
          <ThemeToggle />
        </div>
      </header>

      {/* pb-20 deja lugar para la bottom nav, que es fija. */}
      <main className="min-w-0 flex-1 p-4 pb-20 md:pb-6">{children}</main>

      <nav
        aria-label="Navegación principal"
        className="border-border bg-surface fixed inset-x-0 bottom-0 flex border-t px-2 py-1 md:hidden"
      >
        {nav.map((item) => link(item, itemClass(item.id === activeNavId, 'bottom'), item.id === activeNavId))}
      </nav>
    </div>
  );
}
