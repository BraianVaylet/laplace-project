import { Button, Card, EmptyState, MobileShell, type NavItem } from '@laplace/ui';
import { Providers } from './providers.js';
import { InstallPrompt } from './pwa/InstallPrompt.js';
import { UpdateGate } from './pwa/UpdateGate.js';

/**
 * Shell de la WAFM (§5.1.3). **Mobile first**: el socio la usa de pie, apurado,
 * con una mano. Por eso la navegación va abajo en el teléfono y arriba recién
 * desde tablet.
 */
const NAV: NavItem[] = [
  { id: 'home', label: 'Inicio', href: '/', icon: '◧' },
  { id: 'schedule', label: 'Horario', href: '/horario', icon: '▤' },
  { id: 'packs', label: 'Mis packs', href: '/packs', icon: '◫' },
  { id: 'qr', label: 'Mi QR', href: '/qr', icon: '▩' },
  { id: 'profile', label: 'Perfil', href: '/perfil', icon: '◉' },
];

export function App() {
  return (
    <Providers>
      <MobileShell brand="Laplace" nav={NAV} activeNavId="home">
        <div className="flex flex-col gap-4">
          <h1 className="text-fg text-xl font-semibold">Hoy</h1>

          <Card title="Tus próximas clases">
            <EmptyState
              title="No tenés reservas"
              description="Mirá el horario del centro y anotate."
              action={<Button>Ver horario</Button>}
            />
          </Card>
        </div>
      </MobileShell>

      <InstallPrompt />
      <UpdateGate />
    </Providers>
  );
}
