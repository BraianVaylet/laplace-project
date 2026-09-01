import type { ReactNode } from 'react';
import { cn } from '../cn.js';
import { useTheme } from '../theme.js';

/**
 * El esqueleto que comparten DFSA y DFSM (§5.1.1 y §5.1.2): header, panel
 * lateral colapsable y footer. La WAFM tiene el suyo, con bottom nav.
 */
export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
}

export interface AppShellProps {
  /** Nombre del producto o del centro, arriba a la izquierda. */
  brand: ReactNode;
  nav: readonly NavItem[];
  activeNavId?: string;
  /** El selector de Venue del DFSM, cuando hay mas de uno (§5.1.2). */
  headerExtra?: ReactNode;
  userMenu?: ReactNode;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
  /** Se renderiza como `<a>` salvo que el router provea otra cosa. */
  renderLink?: (item: NavItem, className: string, active: boolean) => ReactNode;
}

export function AppShell({
  brand,
  nav,
  activeNavId,
  headerExtra,
  userMenu,
  collapsed,
  onToggleCollapsed,
  children,
  renderLink,
}: AppShellProps) {
  const defaultLink = (item: NavItem, className: string, active: boolean) => (
    <a key={item.id} href={item.href} className={className} aria-current={active ? 'page' : undefined}>
      {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
      <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
    </a>
  );

  const link = renderLink ?? defaultLink;

  return (
    <div className="bg-bg text-fg flex min-h-dvh flex-col">
      <header className="border-border bg-surface flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
          className="focus-visible:focus-ring hover:bg-surface-2 size-11 shrink-0 rounded-md"
        >
          <span aria-hidden="true">☰</span>
          <span className="sr-only">
            {collapsed ? 'Expandir el panel lateral' : 'Comprimir el panel lateral'}
          </span>
        </button>

        <div className="text-fg font-semibold">{brand}</div>

        <div className="ml-auto flex items-center gap-2">
          {headerExtra}
          <ThemeToggle />
          {userMenu}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          id="app-sidebar"
          aria-label="Navegación principal"
          className={cn(
            'border-border bg-surface hidden shrink-0 border-r p-2 md:block',
            collapsed ? 'w-16' : 'w-56',
          )}
        >
          <ul className="flex flex-col gap-1">
            {nav.map((item) => {
              const active = item.id === activeNavId;
              return (
                <li key={item.id}>
                  {link(
                    item,
                    cn(
                      'focus-visible:focus-ring flex h-11 items-center gap-3 rounded-md px-3 text-sm',
                      active ? 'bg-surface-3 text-fg font-medium' : 'text-fg-muted hover:bg-surface-2',
                      collapsed && 'justify-center px-0',
                    ),
                    active,
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      <footer className="border-border text-fg-muted shrink-0 border-t px-4 py-3 text-xs">
        Laplace · gestión de centros deportivos
      </footer>
    </div>
  );
}

/** Cambio de tema, en el header de las cuatro apps (§5.1). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const next = { dark: 'light', light: 'system', system: 'dark' } as const;
  const label = { dark: 'Oscuro', light: 'Claro', system: 'Sistema' } as const;

  return (
    <button
      type="button"
      onClick={() => setTheme(next[theme])}
      className="focus-visible:focus-ring hover:bg-surface-2 text-fg-muted h-11 rounded-md px-3 text-sm"
    >
      <span aria-hidden="true">{theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'}</span>
      <span className="sr-only">Tema: {label[theme]}. Cambiar a {label[next[theme]]}.</span>
    </button>
  );
}
