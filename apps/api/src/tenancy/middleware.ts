import { createMiddleware } from 'hono/factory';
import type { OrgEnv } from '../auth/organization.js';

import { runWithTenant } from './context.js';

/**
 * Abre el contexto de tenant para el resto del pedido. Va despues de
 * `requireSession` y `requireOrganization`.
 *
 * El `tenantId` sale de la organizacion activa de la SESION (ADR-000 regla 2).
 * Un `tenantId` en el body o en la query se ignora por completo: aceptarlo
 * convertiria cualquier endpoint en un pase libre a los datos de otro centro.
 */
/** El env de esta capa: lo de la organizacion mas el requestId del pedido. */
type TenantEnv = OrgEnv & { Variables: { requestId: string } };

export const tenantContext = createMiddleware<TenantEnv>(async (c, next) => {
  const org = c.get('org');
  const userId = c.get('userId');

  await runWithTenant(
    {
      tenantId: org.organizationId,
      userId,
      requestId: c.get('requestId') ?? 'unknown',
      ...(org.venueId === undefined ? {} : { venueId: org.venueId }),
    },
    async () => {
      await next();
    },
  );
});
