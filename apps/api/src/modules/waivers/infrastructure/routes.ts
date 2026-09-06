import { Hono } from 'hono';
import { z } from 'zod';
import {
  complianceEntrySchema,
  legalDocumentSchema,
  pendingDocumentSchema,
  paginatedSchema,
  paginationQuerySchema,
  publishLegalDocumentSchema,
  type PublishLegalDocumentInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { registerRoutes } from '../../../http/route-registry.js';
import { parseQuery, validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import { complianceToCsv } from '../domain/compliance-csv.js';
import type { WaiverService } from '../application/waiver-service.js';

const idParams = z.object({ id: z.string() });

/** `format=csv` devuelve el panel de cumplimiento para pegarlo en una planilla. */
const complianceQuery = paginationQuerySchema.extend({
  format: z.enum(['json', 'csv']).default('json'),
});

/** Quien pide sus documentos pendientes: la ficha sale de su sesión, nunca del cuerpo (ADR-000). */
export type MemberResolver = (userId: string) => Promise<string | null>;

/** El título del documento que siembra `seedVictim`, para la suite de F0-05. */
export const VICTIM_DOCUMENT_TITLE = 'Documento del otro centro';

export function createWaiverRoutes(
  service: WaiverService,
  entitlements: EntitlementsLoader,
  resolveMember: MemberResolver,
  seedVictim: (victimTenantId: string) => Promise<{ documentId: string }>,
) {
  registerRoutes([
    {
      method: 'POST',
      path: '/api/v1/legal-documents',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/legal-documents',
          body: {
            type: 'liability_waiver',
            title: 'Sonda de aislamiento',
            contentHtml: '<p>sonda</p>',
          },
        }),
      summary: 'Publicar una versión nueva de un documento legal',
      tags: ['waivers'],
      permission: { waiver: ['publish'] },
      request: { body: publishLegalDocumentSchema },
      response: { status: 201, schema: legalDocumentSchema },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/legal-documents/pending',
      tenantScoped: true,
      // Sin ficha de socio, la lista sale vacía: no hay nada del tenant
      // victima que un atacante sin ficha pueda ver acá.
      isolationFixture: () => Promise.resolve({ path: '/api/v1/legal-documents/pending' }),
      summary: 'Mis documentos pendientes de firma',
      tags: ['waivers'],
      permission: { waiver: ['read'] },
      response: { status: 200, schema: z.array(pendingDocumentSchema) },
      errorCodes: ['LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/legal-documents/:id/accept',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/legal-documents/${(await seedVictim(victimTenantId)).documentId}/accept`,
        body: {},
      }),
      summary: 'Firmar un documento',
      tags: ['waivers'],
      permission: { waiver: ['accept'] },
      request: { params: idParams },
      response: { status: 200, schema: z.object({ accepted: z.literal(true) }) },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/legal-documents/:id/compliance',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/legal-documents/${(await seedVictim(victimTenantId)).documentId}/compliance`,
      }),
      summary: 'Quién firmó este documento y cuándo',
      tags: ['waivers'],
      permission: { waiver: ['publish'] },
      request: { params: idParams, query: complianceQuery },
      response: { status: 200, schema: paginatedSchema(complianceEntrySchema) },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002', 'LP-SYS-422-006'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('waivers'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/legal-documents', guard);
    routes.use('/api/v1/legal-documents/*', guard);
  }

  routes.post(
    '/api/v1/legal-documents',
    requirePermission({ waiver: ['publish'] }),
    validated<PublishLegalDocumentInput, AppEnv>(publishLegalDocumentSchema, async (c, input) =>
      c.json(await service.publish(input), 201),
    ),
  );

  routes.get(
    '/api/v1/legal-documents/pending',
    requirePermission({ waiver: ['read'] }),
    async (c) => {
      const memberId = await resolveMember(c.get('userId') as string);
      if (!memberId) return c.json([]);

      return c.json(await service.pendingFor(memberId));
    },
  );

  routes.post(
    '/api/v1/legal-documents/:id/accept',
    requirePermission({ waiver: ['accept'] }),
    async (c) => {
      await service.accept(c.get('userId') as string, c.req.param('id') as string, {
        ip: clientIpOf(c.req.header('x-forwarded-for')),
        userAgent: c.req.header('user-agent') ?? 'desconocido',
      });

      return c.json({ accepted: true as const });
    },
  );

  routes.get(
    '/api/v1/legal-documents/:id/compliance',
    requirePermission({ waiver: ['publish'] }),
    async (c) => {
      const query = parseQuery(complianceQuery, c.req.query());
      const documentId = c.req.param('id') as string;

      if (query.format === 'csv') {
        const entradas = await service.complianceExportOf(documentId);

        return new Response(complianceToCsv(entradas), {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="cumplimiento-${documentId}.csv"`,
          },
        });
      }

      return c.json(await service.complianceOf(documentId, query.cursor, query.limit));
    },
  );

  return routes;
}

/**
 * El primer eslabón de `x-forwarded-for` es el cliente original; los
 * siguientes son cada proxy que reenvió el pedido (Railway incluido).
 */
function clientIpOf(header: string | undefined): string {
  const primero = header?.split(',')[0]?.trim();

  return primero && primero.length > 0 ? primero : 'desconocida';
}
