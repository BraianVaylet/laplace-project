import { useState } from 'react';
import { AppShell, Card, EmptyState, Button, type NavItem } from '@laplace/ui';
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

function Home() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg text-xl font-semibold">Hoy</h1>

      <Card title="Clases de hoy">
        <EmptyState
          title="Todavía no tenés clases"
          description="Creá la primera y empezá a recibir reservas."
          action={<Button>Crear la primera</Button>}
        />
      </Card>
    </div>
  );
}

export function App() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  // Placeholder hasta F1-01: las sedes salen de la API.
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
        <Home />
      </AppShell>
    </Providers>
  );
}
