import { Hono } from 'hono';
import {
  confirmImportSchema,
  importResultSchema,
  previewImportSchema,
  previewResultSchema,
  type ConfirmImportInput,
  type PreviewImportInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { Entitlements } from '../../../entitlements/entitlements.js';
import type { MemberImportService } from '../application/member-import-service.js';

/**
 * Rutas de importación masiva.
 *
 * No llevan guard de `requireWithinLimit`: ese guard corta **de a uno**, y acá
 * hay que poder decir "de los 143 del archivo, 12 no entran". El chequeo del
 * plan lo hace el servicio con el número exacto, antes de escribir.
 */
export function createImportRoutes(
  service: MemberImportService,
  entitlements: EntitlementsLoader,
  /** Siembra un socio del tenant víctima, para el fixture de aislamiento. */
  seedVictimMember: (victimTenantId: string) => Promise<string>,
) {
  /*
   * El ataque acá no es leer una ficha: es preguntarle a la previsualización si
   * un documento del otro centro ya existe. Un `duplicate` de vuelta confirmaría
   * que esa persona es socia de ese centro.
   */
  const probeForeignDoc: IsolationFixture = async ({ victimTenantId }) => {
    await seedVictimMember(victimTenantId);

    return {
      path: '/api/v1/members/import/preview',
      body: { csv: 'nombre,apellido,documento\nSonda,Ajena,99999999' },
    };
  };

  registerRoutes([
    {
      method: 'POST',
      path: '/api/v1/members/import/preview',
      tenantScoped: true,
      isolationFixture: probeForeignDoc,
      summary: 'Previsualizar una importación de socios',
      tags: ['members'],
      permission: { athlete: ['import'] },
      request: { body: previewImportSchema },
      response: { status: 200, schema: previewResultSchema },
      errorCodes: ['LP-MEMB-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/members/import',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/members/import',
          body: {
            venueIds: ['ven_ajena'],
            rows: [{ firstName: 'Sonda', lastName: 'Ajena' }],
          },
        }),
      summary: 'Confirmar una importación de socios',
      tags: ['members'],
      permission: { athlete: ['import'] },
      request: { body: confirmImportSchema },
      response: { status: 200, schema: importResultSchema },
      errorCodes: ['LP-MEMB-409-001', 'LP-ENTL-403-001', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('members'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/members/import', guard);
    routes.use('/api/v1/members/import/*', guard);
  }

  routes.post(
    '/api/v1/members/import/preview',
    requirePermission({ athlete: ['import'] }),
    validated<PreviewImportInput, AppEnv>(previewImportSchema, async (c, input) =>
      c.json(await service.preview(input.csv, seatLimit(c.get('entitlements')))),
    ),
  );

  routes.post(
    '/api/v1/members/import',
    requirePermission({ athlete: ['import'] }),
    validated<ConfirmImportInput, AppEnv>(confirmImportSchema, async (c, input) =>
      c.json(await service.confirm(input, seatLimit(c.get('entitlements')))),
    ),
  );

  return routes;
}

/** El cupo de socios del plan activo. `null` = sin límite. */
function seatLimit(entitlements: Entitlements | undefined): number | null {
  return entitlements?.limits.activeMembers ?? null;
}
