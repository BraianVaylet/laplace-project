import { createHash } from 'node:crypto';

/**
 * El hash del texto de una versión (§2.1.20). Es prueba de integridad, no de
 * identidad: la identidad de quien firma la da el `userId` de la sesión; esto
 * prueba que el HTML que el socio vio es exactamente el que quedó guardado.
 */
export function hashContent(contentHtml: string): string {
  return createHash('sha256').update(contentHtml).digest('hex');
}
