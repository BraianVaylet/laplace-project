import { AppShell, Card, EmptyState, Button, type NavItem } from '@laplace/ui';
import { useUiStore } from '@laplace/client';
import { Providers } from './providers.js';

/**
 * Shell del DFSA (§5.1.1). Pensado **para desktop**: es la herramienta del
 * super admin, no algo que se use de pie.
 *
 * El acceso lo corta el backend con `requireSuperAdmin` + `requireTwoFactor`
 * (F0-03). Acá no hay nada que proteger que no esté protegido allá: esconder
 * una pantalla no es una restricción.
 */
const NAV: NavItem[] = [
  { id: 'subscribers', label: 'Suscriptores', href: '/suscriptores', icon: '◧' },
  { id: 'plans', label: 'Planes', href: '/planes', icon: '◫' },
  { id: 'exercises', label: 'Ejercicios', href: '/ejercicios', icon: '▤' },
  { id: 'legal', label: 'Textos legales', href: '/legales', icon: '☰' },
  { id: 'health', label: 'Salud del sistema', href: '/salud', icon: '◔' },
];

export function App() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();

  return (
    <Providers>
      <AppShell
        brand="Laplace · Admin"
        nav={NAV}
        activeNavId="subscribers"
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
      >
        <div className="flex flex-col gap-4">
          <h1 className="text-fg text-xl font-semibold">Suscriptores</h1>

          <Card title="Centros con cuenta">
            <EmptyState
              title="Todavía no hay suscriptores"
              description="Los centros se dan de alta solos desde la landing, con el trial de 14 días."
              action={<Button variant="secondary">Ver la landing</Button>}
            />
          </Card>
        </div>
      </AppShell>
    </Providers>
  );
}
