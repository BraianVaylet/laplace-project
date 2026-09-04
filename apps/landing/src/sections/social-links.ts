/**
 * Las redes del producto (§5.1.4). Viven como datos y no dentro del componente
 * para que agregar una sea agregar una linea, y para que el test pueda
 * verificar que ninguna quedo sin `rel="noopener"`.
 */
export interface SocialLink {
  id: string;
  label: string;
  href: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { id: 'instagram', label: 'Instagram', href: 'https://instagram.com/laplace.app' },
  { id: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/company/laplace-app' },
  { id: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/5492914000000' },
];
