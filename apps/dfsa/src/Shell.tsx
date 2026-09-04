import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@laplace/ui';
import { useUiStore } from '@laplace/client';
import { Providers } from './providers.js';

/**
 * Shell del DFSA (§5.1.1). Pensado **para desktop**: es la herramienta del
 * super admin, no algo que se use de pie.
 *
 * El acceso lo corta el backend con `requireSuperAdmin` + `requireTwoFactor`.
 * Acá no hay nada que proteger que no esté protegido allá: esconder una
 * pantalla no es una restricción.
 */
const NAV: NavItem[] = [
  { id: 'subscribers', label: 'Suscriptores', href: '/suscriptores', icon: '◧' },
  { id: 'plans', label: 'Planes', href: '/planes', icon: '◫' },
  { id: 'exercises', label: 'Ejercicios', href: '/ejercicios', icon: '▤' },
  { id: 'legal', label: 'Textos legales', href: '/legales', icon: '☰' },
  { id: 'health', label: 'Salud del sistema', href: '/salud', icon: '◔' },
];

export function Shell({
  children,
  activeNavId = 'subscribers',
}: {
  children: ReactNode;
  activeNavId?: string;
}) {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  return (
    <Providers>
      <AppShell
        brand="Laplace · Admin"
        nav={NAV}
        activeNavId={activeNavId}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
