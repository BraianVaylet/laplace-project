import { Hono } from 'hono';
import { z } from 'zod';
import {
  classSessionSchema,
  classTemplateSchema,
  createClassTemplateSchema,
  createSessionSchema,
  paginatedSchema,
  paginationQuerySchema,
  cancelSessionSchema,
  createClosureSchema,
  duplicateWeekResultSchema,
  duplicateWeekSchema,
  editScopeSchema,
  updateClassTemplateSchema,
  updateSessionSchema,
  venueClosureSchema,
  type CancelSessionInput,
  type CreateClassTemplateInput,
  type CreateClosureInput,
  type CreateSessionInput,
  type DuplicateWeekInput,
  type UpdateClassTemplateInput,
  type UpdateSessionInput,
} from '@laplace/schemas';
import { Temporal } from '@js-temporal/polyfill';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { parseQuery, validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { ScheduleService } from '../application/schedule-service.js';

const idParams = z.object({ id: z.string() });

/** La agenda se pide por rango: sirve igual para el día, la semana y el mes. */
const agendaQuery = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

/** Nombre de la clase sembrada por los fixtures. No puede salir en ninguna respuesta ajena. */
export const VICTIM_TEMPLATE_NAME = 'Clase del otro centro';

export function createScheduleRoutes(
  service: ScheduleService,
  entitlements: EntitlementsLoader,
  seedVictim: (victimTenantId: string) => Promise<{ templateId: string; sessionId: string }>,
) {
  const attackTemplate: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/class-templates/${(await seedVictim(victimTenantId)).templateId}`,
  });

  const attackSession: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/sessions/${(await seedVictim(victimTenantId)).sessionId}`,
  });

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/class-templates',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => {
        await seedVictim(victimTenantId);
        return { path: '/api/v1/class-templates' };
      },
      summary: 'Plantillas de clase del centro',
      tags: ['schedule'],
      permission: { classSession: ['read'] },
      request: { query: paginationQuerySchema },
      response: { status: 200, schema: paginatedSchema(classTemplateSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002', 'LP-SYS-422-006'],
    },
    {
      method: 'POST',
      path: '/api/v1/class-templates',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/class-templates',
          body: {
            venueId: 'ven_x',
            roomId: 'rom_x',
            name: 'Sonda',
            categoryId: 'funcional',
            durationMin: 60,
            recurrence: { byWeekday: [1], timeOfDay: '07:00', from: '2026-03-02' },
          },
        }),
      summary: 'Crear una plantilla recurrente',
      tags: ['schedule'],
      permission: { classSession: ['create'] },
      request: { body: createClassTemplateSchema },
      response: { status: 201, schema: classTemplateSchema },
      errorCodes: ['LP-SCHD-422-004', 'LP-SCHD-404-008', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/class-templates/:id',
      tenantScoped: true,
      isolationFixture: attackTemplate,
      summary: 'Ver una plantilla',
      tags: ['schedule'],
      permission: { classSession: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: classTemplateSchema },
      errorCodes: ['LP-SCHD-404-008', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/class-templates/:id',
      tenantScoped: true,
      isolationFixture: attackTemplate,
      summary: 'Editar una plantilla',
      tags: ['schedule'],
      permission: { classSession: ['update'] },
      request: {
        params: idParams,
        query: z.object({ scope: editScopeSchema.optional() }),
        body: updateClassTemplateSchema,
      },
      response: { status: 200, schema: classTemplateSchema },
      errorCodes: ['LP-SCHD-404-008', 'LP-SCHD-422-004', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/class-templates/:id/archive',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await attackTemplate(context)).path}/archive`,
      }),
      summary: 'Archivar una plantilla',
      tags: ['schedule'],
      permission: { classSession: ['update'] },
      request: { params: idParams },
      response: { status: 200, schema: classTemplateSchema },
      errorCodes: ['LP-SCHD-404-008', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/sessions',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => {
        await seedVictim(victimTenantId);
        return {
          path: '/api/v1/sessions?venueId=ven_victima&from=2020-01-01T00:00:00Z&to=2040-01-01T00:00:00Z',
        };
      },
      summary: 'Agenda de una sede entre dos fechas',
      tags: ['schedule'],
      permission: { classSession: ['read'] },
      request: { query: agendaQuery },
      response: { status: 200, schema: z.array(classSessionSchema) },
      errorCodes: ['LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/sessions',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/sessions',
          body: {
            venueId: 'ven_x',
            roomId: 'rom_x',
            name: 'Sonda',
            categoryId: 'funcional',
            startAt: '2026-03-02T10:00:00Z',
            durationMin: 60,
          },
        }),
      summary: 'Crear una clase suelta',
      tags: ['schedule'],
      permission: { classSession: ['create'] },
      request: { body: createSessionSchema },
      response: { status: 201, schema: classSessionSchema },
      errorCodes: ['LP-SCHD-409-003', 'LP-SCHD-404-008', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/sessions/:id',
      tenantScoped: true,
      isolationFixture: attackSession,
      summary: 'Editar una clase — solo esa clase',
      tags: ['schedule'],
      permission: { classSession: ['update'] },
      request: { params: idParams, body: updateSessionSchema },
      response: { status: 200, schema: classSessionSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-SCHD-422-005', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:id/cancel',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await attackSession(context)).path}/cancel`,
        body: { reason: 'Sonda de aislamiento.' },
      }),
      summary: 'Cancelar una clase y devolver los créditos',
      tags: ['schedule'],
      permission: { classSession: ['cancel'] },
      request: { params: idParams, body: cancelSessionSchema },
      response: { status: 200, schema: classSessionSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-SCHD-422-005', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/closures',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => {
        await seedVictim(victimTenantId);
        return { path: '/api/v1/closures?venueId=ven_victima' };
      },
      summary: 'Feriados y cierres de una sede',
      tags: ['schedule'],
      permission: { classSession: ['read'] },
      request: { query: z.object({ venueId: z.string() }) },
      response: { status: 200, schema: z.array(venueClosureSchema) },
      errorCodes: ['LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/closures',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/closures',
          body: { venueId: 'ven_victima', from: '2026-03-10', to: '2026-03-10', reason: 'Sonda' },
        }),
      summary: 'Declarar un feriado o cierre y cancelar sus clases',
      tags: ['schedule'],
      permission: { classSession: ['cancel'] },
      request: { body: createClosureSchema },
      response: { status: 201, schema: venueClosureSchema },
      errorCodes: ['LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/duplicate-week',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/sessions/duplicate-week',
          body: { venueId: 'ven_victima', fromWeek: '2026-03-02', toWeek: '2026-03-09' },
        }),
      summary: 'Copiar la grilla de una semana a otra',
      tags: ['schedule'],
      permission: { classSession: ['create'] },
      request: { body: duplicateWeekSchema },
      response: { status: 200, schema: duplicateWeekResultSchema },
      errorCodes: ['LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/sessions/:id',
      tenantScoped: true,
      isolationFixture: attackSession,
      summary: 'Ver una clase',
      tags: ['schedule'],
      permission: { classSession: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: classSessionSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('schedule'),
  ] as const;

  for (const guard of guards) {
    for (const path of [
      '/api/v1/class-templates',
      '/api/v1/class-templates/*',
      '/api/v1/sessions',
      '/api/v1/sessions/*',
      '/api/v1/closures',
    ]) {
      routes.use(path, guard);
    }
  }

  routes.get(
    '/api/v1/class-templates',
    requirePermission({ classSession: ['read'] }),
    async (c) => {
      const query = parseQuery(paginationQuerySchema, c.req.query());
      const venueId = c.req.query('venueId');

      return c.json(await service.listTemplates(venueId, query.cursor, query.limit));
    },
  );

  routes.post(
    '/api/v1/class-templates',
    requirePermission({ classSession: ['create'] }),
    validated<CreateClassTemplateInput, AppEnv>(createClassTemplateSchema, async (c, input) =>
      c.json(await service.createTemplate(input), 201),
    ),
  );

  routes.get('/api/v1/class-templates/:id', requirePermission({ classSession: ['read'] }), (c) =>
    service.getTemplate(c.req.param('id')).then((template) => c.json(template)),
  );

  routes.patch(
    '/api/v1/class-templates/:id',
    requirePermission({ classSession: ['update'] }),
    validated<UpdateClassTemplateInput, AppEnv>(updateClassTemplateSchema, async (c, input) => {
      // Sin `scope`, solo cambia la plantilla: propagar por default reescribiria
      // clases que ya estan publicadas sin que nadie lo pidiera.
      const scope = editScopeSchema.catch('template_only').parse(c.req.query('scope'));
      const { template, updatedSessions } = await service.updateTemplateWithScope(
        c.req.param('id') as string,
        input,
        scope,
      );

      return c.json({ ...template, updatedSessions });
    }),
  );

  routes.post(
    '/api/v1/class-templates/:id/archive',
    requirePermission({ classSession: ['update'] }),
    (c) => service.setTemplateActive(c.req.param('id'), false).then((t) => c.json(t)),
  );

  routes.get('/api/v1/sessions', requirePermission({ classSession: ['read'] }), async (c) => {
    const query = parseQuery(agendaQuery, c.req.query());

    return c.json(
      await service.agenda(
        query.venueId,
        Temporal.Instant.from(query.from),
        Temporal.Instant.from(query.to),
      ),
    );
  });

  routes.post(
    '/api/v1/sessions',
    requirePermission({ classSession: ['create'] }),
    validated<CreateSessionInput, AppEnv>(createSessionSchema, async (c, input) =>
      c.json(await service.createSession(input), 201),
    ),
  );

  /*
   * `duplicate-week` va ANTES que `/sessions/:id`: con la ruta de id adelante,
   * el `:id` se quedaria con el pedido.
   */
  routes.post(
    '/api/v1/sessions/duplicate-week',
    requirePermission({ classSession: ['create'] }),
    validated<DuplicateWeekInput, AppEnv>(duplicateWeekSchema, async (c, input) =>
      c.json(await service.duplicateWeek(input)),
    ),
  );

  routes.get('/api/v1/sessions/:id', requirePermission({ classSession: ['read'] }), (c) =>
    service.getSession(c.req.param('id')).then((session) => c.json(session)),
  );

  routes.patch(
    '/api/v1/sessions/:id',
    requirePermission({ classSession: ['update'] }),
    validated<UpdateSessionInput, AppEnv>(updateSessionSchema, async (c, input) =>
      c.json(await service.updateSession(c.req.param('id') as string, input)),
    ),
  );

  routes.post(
    '/api/v1/sessions/:id/cancel',
    requirePermission({ classSession: ['cancel'] }),
    validated<CancelSessionInput, AppEnv>(cancelSessionSchema, async (c, input) =>
      c.json(await service.cancelSession(c.req.param('id') as string, input.reason)),
    ),
  );

  routes.get('/api/v1/closures', requirePermission({ classSession: ['read'] }), async (c) => {
    const venueId = z.string().min(1).parse(c.req.query('venueId'));

    return c.json(await service.listClosures(venueId));
  });

  routes.post(
    '/api/v1/closures',
    requirePermission({ classSession: ['cancel'] }),
    validated<CreateClosureInput, AppEnv>(createClosureSchema, async (c, input) =>
      c.json(await service.declareClosure(input), 201),
    ),
  );

  return routes;
}
