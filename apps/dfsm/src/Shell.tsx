import { useState, type ReactNode } from 'react';
import { AppShell, type NavItem } from '@laplace/ui';
import { useUiStore } from '@laplace/client';
import { Providers } from './providers.js';
import { VenueSelector, type Venue } from './VenueSelector.js';

/**
 * Shell del DFSM (§5.1.2): header con selector de Venue, panel lateral
 * colapsable y footer. Pensado para desktop **y mobile**: el coach usa la lista
 * de clase de pie, con una mano.
 */
const NAV: NavItem[] = [
  { id: 'home', label: 'Hoy', href: '/', icon: '◧' },
  { id: 'schedule', label: 'Horario', href: '/horario', icon: '▤' },
  { id: 'members', label: 'Miembros', href: '/miembros', icon: '☰' },
  { id: 'products', label: 'Productos', href: '/productos', icon: '◫' },
  { id: 'billing', label: 'Cobranza', href: '/cobranza', icon: '◈' },
  { id: 'metrics', label: 'Métricas', href: '/metricas', icon: '◔' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  // Placeholder hasta que el listado de sedes salga de la API.
  const [venues] = useState<Venue[]>([]);

  return (
    <Providers>
      <AppShell
        brand="Laplace"
        nav={NAV}
        activeNavId="home"
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        headerExtra={<VenueSelector venues={venues} />}
      >
        {children}
      </AppShell>
    </Providers>
  );
}
