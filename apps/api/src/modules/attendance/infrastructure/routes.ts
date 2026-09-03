import { Hono } from 'hono';
import { z } from 'zod';
import {
  bulkCheckInResultSchema,
  checkInResultSchema,
  checkInSchema,
  classRosterSchema,
  type CheckInInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { requireIdempotencyKey } from '../../../http/idempotency.js';
import { registerRoutes } from '../../../http/route-registry.js';
import { validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { AttendanceService } from '../application/attendance-service.js';

const sessionParams = z.object({ sessionId: z.string() });
const bookingParams = z.object({ id: z.string() });

/**
 * Las rutas de Attendance. La lista de clase es **una sola llamada** a
 * proposito: el coach la abre de pie, con una mano, y encadenar pedidos para
 * armar la pantalla es pedirle que espere tres veces (§5.1.2).
 */
export function createAttendanceRoutes(
  service: AttendanceService,
  entitlements: EntitlementsLoader,
  seedVictim: (victimTenantId: string) => Promise<{ sessionId: string; bookingId: string }>,
) {
  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/sessions/:sessionId/roster',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/sessions/${(await seedVictim(victimTenantId)).sessionId}/roster`,
      }),
      summary: 'La lista de clase del coach',
      tags: ['attendance'],
      permission: { attendance: ['read'] },
      request: { params: sessionParams },
      response: { status: 200, schema: classRosterSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/bookings/:id/check-in',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/bookings/${(await seedVictim(victimTenantId)).bookingId}/check-in`,
        body: {},
      }),
      summary: 'Registrar el ingreso de una reserva',
      tags: ['attendance'],
      permission: { attendance: ['checkIn'] },
      request: { params: bookingParams, body: checkInSchema },
      response: { status: 200, schema: checkInResultSchema },
      errorCodes: [
        'LP-ATTD-404-005',
        'LP-ATTD-409-001',
        'LP-ATTD-409-006',
        'LP-ATTD-422-002',
        'LP-ATTD-403-003',
        'LP-BOOK-403-005',
        'LP-SYS-422-006',
      ],
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:sessionId/check-in-all',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/sessions/${(await seedVictim(victimTenantId)).sessionId}/check-in-all`,
        body: {},
      }),
      summary: 'Marcar presentes a todos los anotados',
      tags: ['attendance'],
      permission: { attendance: ['checkIn'] },
      request: { params: sessionParams },
      response: { status: 200, schema: bulkCheckInResultSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-AUTH-403-002', 'LP-SYS-422-006'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('attendance'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/sessions/:sessionId/roster', guard);
    routes.use('/api/v1/sessions/:sessionId/check-in-all', guard);
    routes.use('/api/v1/bookings/:id/check-in', guard);
  }

  routes.get(
    '/api/v1/sessions/:sessionId/roster',
    requirePermission({ attendance: ['read'] }),
    async (c) => c.json(await service.roster(c.req.param('sessionId') as string)),
  );

  routes.post(
    '/api/v1/bookings/:id/check-in',
    requirePermission({ attendance: ['checkIn'] }),
    // §5.0: idempotencia obligatoria en check-in. Sin la clave, el segundo toque
    // del coach sobre una lista lenta manda dos veces.
    requireIdempotencyKey,
    validated<CheckInInput, AppEnv>(checkInSchema, async (c, input) => {
      const entrada = await service.checkIn(
        c.req.param('id') as string,
        input.method,
        c.get('userId') as string,
      );

      return c.json({
        bookingId: entrada.publicId,
        sessionId: entrada.sessionId,
        memberId: entrada.memberId,
        status: entrada.status,
        checkedInAt: entrada.checkedInAt?.toString() ?? null,
        checkInMethod: entrada.checkInMethod,
      });
    }),
  );

  routes.post(
    '/api/v1/sessions/:sessionId/check-in-all',
    requirePermission({ attendance: ['checkIn'] }),
    requireIdempotencyKey,
    async (c) =>
      c.json(
        await service.checkInAll(c.req.param('sessionId') as string, c.get('userId') as string),
      ),
  );

  return routes;
}
