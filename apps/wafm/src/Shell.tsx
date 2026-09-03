import type { ReactNode } from 'react';
import { MobileShell, type NavItem } from '@laplace/ui';
import { InstallPrompt } from './pwa/InstallPrompt.js';
import { UpdateGate } from './pwa/UpdateGate.js';
import { Providers } from './providers.js';

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

export function Shell({
  children,
  activeNavId = 'home',
}: {
  children: ReactNode;
  activeNavId?: string;
}) {
  return (
    <Providers>
      <MobileShell brand="Laplace" nav={NAV} activeNavId={activeNavId}>
        {children}
      </MobileShell>

      <InstallPrompt />
      <UpdateGate />
    </Providers>
  );
}
