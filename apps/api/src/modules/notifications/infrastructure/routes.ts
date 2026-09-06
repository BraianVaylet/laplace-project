import { Hono } from 'hono';
import { z } from 'zod';
import {
  deliveryLogEntrySchema,
  notificationListQuerySchema,
  notificationPreferenceSchema,
  notificationSchema,
  notificationStatusSchema,
  notificationTemplateSchema,
  paginatedSchema,
  paginationQuerySchema,
  previewTemplateSchema,
  saveTemplateSchema,
  templatePreviewSchema,
  updatePreferencesSchema,
  type PreviewTemplateInput,
  type SaveTemplateInput,
  type UpdatePreferencesInput,
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
import type { NotificationService } from '../application/notification-service.js';

const idParams = z.object({ id: z.string() });

const deliveryLogQuery = paginationQuerySchema.extend({
  userId: z.string().optional(),
  status: notificationStatusSchema.optional(),
});

/** El asunto del aviso que siembra `seedVictim`, para la suite de F0-05. */
export const VICTIM_NOTIFICATION_SUBJECT = 'Aviso del otro centro';

export function createNotificationRoutes(
  service: NotificationService,
  entitlements: EntitlementsLoader,
  seedVictim: (victimTenantId: string) => Promise<{ notificationId: string }>,
) {
  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/notifications',
      tenantScoped: true,
      // La campana es del usuario de la sesión: el atacante ve la suya, vacía.
      isolationFixture: () => Promise.resolve({ path: '/api/v1/notifications' }),
      summary: 'Mis avisos',
      tags: ['notifications'],
      permission: { notification: ['read'] },
      request: { query: notificationListQuerySchema },
      response: { status: 200, schema: paginatedSchema(notificationSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-422-006'],
    },
    {
      method: 'GET',
      path: '/api/v1/notifications/unread-count',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/notifications/unread-count' }),
      summary: 'Cuántos avisos sin leer tengo',
      tags: ['notifications'],
      permission: { notification: ['read'] },
      response: { status: 200, schema: z.object({ unread: z.number().int() }) },
      errorCodes: ['LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/notifications/:id/read',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/notifications/${(await seedVictim(victimTenantId)).notificationId}/read`,
        body: {},
      }),
      summary: 'Marcar un aviso como leído',
      tags: ['notifications'],
      permission: { notification: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: z.object({ read: z.literal(true) }) },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/notification-preferences',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/notification-preferences' }),
      summary: 'Qué avisos quiero recibir y por dónde',
      tags: ['notifications'],
      permission: { notification: ['read'] },
      response: { status: 200, schema: z.array(notificationPreferenceSchema) },
      errorCodes: ['LP-AUTH-403-002'],
    },
    {
      method: 'PUT',
      path: '/api/v1/notification-preferences',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/notification-preferences',
          body: {
            preferences: [{ eventType: 'booking.created', channel: 'email', enabled: false }],
          },
        }),
      summary: 'Cambiar mis preferencias de aviso',
      tags: ['notifications'],
      permission: { notification: ['read'] },
      request: { body: updatePreferencesSchema },
      response: { status: 200, schema: z.array(notificationPreferenceSchema) },
      errorCodes: ['LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/notification-templates',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/notification-templates' }),
      summary: 'Las plantillas de los avisos',
      tags: ['notifications'],
      permission: { notification: ['manageTemplates'] },
      response: { status: 200, schema: z.array(notificationTemplateSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'PUT',
      path: '/api/v1/notification-templates',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/notification-templates',
          body: {
            eventType: 'booking.created',
            channel: 'in_app',
            subject: 'Sonda de aislamiento',
            body: 'Hola {{nombre}}.',
          },
        }),
      summary: 'Editar la plantilla de un aviso',
      tags: ['notifications'],
      permission: { notification: ['manageTemplates'] },
      request: { body: saveTemplateSchema },
      response: { status: 200, schema: notificationTemplateSchema },
      errorCodes: ['LP-NOTF-422-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/notification-templates/preview',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/notification-templates/preview',
          body: {
            eventType: 'booking.created',
            channel: 'in_app',
            subject: 'Sonda',
            body: 'Hola {{nombre}}.',
          },
        }),
      summary: 'Vista previa de una plantilla, con datos de ejemplo',
      tags: ['notifications'],
      permission: { notification: ['manageTemplates'] },
      request: { body: previewTemplateSchema },
      response: { status: 200, schema: templatePreviewSchema },
      errorCodes: ['LP-NOTF-422-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/notification-deliveries',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => {
        await seedVictim(victimTenantId);

        return { path: '/api/v1/notification-deliveries' };
      },
      summary: 'Registro de entregas, para soporte',
      tags: ['notifications'],
      permission: { notification: ['viewDeliveryLog'] },
      request: { query: deliveryLogQuery },
      response: { status: 200, schema: paginatedSchema(deliveryLogEntrySchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-SYS-422-006'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('notifications'),
  ] as const;

  for (const guard of guards) {
    for (const prefix of [
      '/api/v1/notifications',
      '/api/v1/notifications/*',
      '/api/v1/notification-preferences',
      '/api/v1/notification-templates',
      '/api/v1/notification-templates/*',
      '/api/v1/notification-deliveries',
    ]) {
      routes.use(prefix, guard);
    }
  }

  routes.get('/api/v1/notifications', requirePermission({ notification: ['read'] }), async (c) => {
    const query = parseQuery(notificationListQuerySchema, c.req.query());

    return c.json(await service.inboxOf(c.get('userId') as string, query));
  });

  routes.get(
    '/api/v1/notifications/unread-count',
    requirePermission({ notification: ['read'] }),
    async (c) => c.json({ unread: await service.unreadCountOf(c.get('userId') as string) }),
  );

  routes.post(
    '/api/v1/notifications/:id/read',
    requirePermission({ notification: ['read'] }),
    async (c) => {
      const marcado = await service.markRead(
        c.req.param('id') as string,
        c.get('userId') as string,
      );
      // Ya leído o de otro: en los dos casos, no hay nada más que hacer. No se
      // distingue a propósito — decir "existe pero no es tuyo" es filtrar.
      if (!marcado) return c.json({ read: true as const });

      return c.json({ read: true as const });
    },
  );

  routes.get(
    '/api/v1/notification-preferences',
    requirePermission({ notification: ['read'] }),
    async (c) => c.json(await service.preferencesOf(c.get('userId') as string)),
  );

  routes.put(
    '/api/v1/notification-preferences',
    requirePermission({ notification: ['read'] }),
    validated<UpdatePreferencesInput, AppEnv>(updatePreferencesSchema, async (c, input) =>
      c.json(await service.updatePreferences(c.get('userId') as string, input)),
    ),
  );

  routes.get(
    '/api/v1/notification-templates',
    requirePermission({ notification: ['manageTemplates'] }),
    async (c) => c.json(await service.templates()),
  );

  routes.put(
    '/api/v1/notification-templates',
    requirePermission({ notification: ['manageTemplates'] }),
    validated<SaveTemplateInput, AppEnv>(saveTemplateSchema, async (c, input) =>
      c.json(await service.saveTemplate(input)),
    ),
  );

  routes.post(
    '/api/v1/notification-templates/preview',
    requirePermission({ notification: ['manageTemplates'] }),
    validated<PreviewTemplateInput, AppEnv>(previewTemplateSchema, async (c, input) =>
      c.json(service.preview(input)),
    ),
  );

  routes.get(
    '/api/v1/notification-deliveries',
    requirePermission({ notification: ['viewDeliveryLog'] }),
    async (c) => {
      const query = parseQuery(deliveryLogQuery, c.req.query());

      return c.json(
        await service.deliveryLog(
          { userId: query.userId, status: query.status },
          { cursor: query.cursor, limit: query.limit },
        ),
      );
    },
  );

  return routes;
}
