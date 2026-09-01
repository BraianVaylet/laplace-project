import { createMiddleware } from 'hono/factory';
import { AppError } from '../http/errors.js';
import { authorize, parseRoleNames, type PermissionRequest } from './permissions.js';
import type { SessionEnv } from './session.js';

/**
 * El contexto de organizacion del pedido. El `organizationId` es lo que en
 * F0-04 pasa a ser el `tenantId` de todo el sistema (ADR-000): sale de la
 * sesion y **nunca** del body ni de la query.
 */
export interface OrgContext {
  organizationId: string;
  memberId: string;
  roles: string[];
}

export type OrgEnv = SessionEnv & { Variables: { org: OrgContext } };

/**
 * Exige que la sesion tenga una organizacion activa y deja su contexto listo.
 * Va siempre despues de `requireSession`.
 *
 * Un mismo email puede ser socio en dos centros y staff en un tercero (§2.1.1):
 * los permisos que valen son los del centro **activo**, no los de otro.
 */
export const requireOrganization = createMiddleware<OrgEnv>(async (c, next) => {
  const auth = c.get('auth');
  const member = await auth.api.getActiveMember({ headers: c.req.raw.headers }).catch(() => null);

  if (!member) {
    throw new AppError({
      code: 'LP-AUTH-403-011',
      status: 403,
      message: 'Elegí un centro para continuar.',
      action: 'Seleccioná el centro con el que querés operar.',
    });
  }

  c.set('org', {
    organizationId: member.organizationId,
    memberId: member.id,
    roles: parseRoleNames(member.role),
  });

  await next();
});

/**
 * Corta si el rol activo no puede ejercer el permiso pedido.
 *
 * Spec §2.1.1: la autorizacion real se resuelve **siempre** en el servidor.
 * `checkRolePermission` en el cliente solo decide si se pinta el boton; lo que
 * manda es esto.
 */
export function requirePermission(request: PermissionRequest) {
  return createMiddleware<OrgEnv>(async (c, next) => {
    const org = c.get('org');
    if (!org) {
      throw new AppError({
        code: 'LP-AUTH-403-011',
        status: 403,
        message: 'Elegí un centro para continuar.',
        action: 'Seleccioná el centro con el que querés operar.',
      });
    }

    if (!authorize(org.roles, request)) {
      throw new AppError({
        code: 'LP-AUTH-403-002',
        status: 403,
        message: 'No tenés permisos para esta acción.',
        meta: { required: request, roles: org.roles },
      });
    }

    await next();
  });
}
