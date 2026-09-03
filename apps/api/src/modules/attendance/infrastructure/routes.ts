import { Hono } from 'hono';
import { z } from 'zod';
import {
  bookingResultSchema,
  bulkCheckInResultSchema,
  checkInResultSchema,
  checkInSchema,
  classRosterSchema,
  qrTokenSchema,
  redeemQrSchema,
  walkInSchema,
  type CheckInInput,
  type RedeemQrInput,
  type WalkInInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { AppError } from '../../../http/errors.js';
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
/** Quien pide el QR: la ficha sale de su sesion, nunca del cuerpo (ADR-000). */
export type MemberResolver = (userId: string) => Promise<string | null>;

export function createAttendanceRoutes(
  service: AttendanceService,
  entitlements: EntitlementsLoader,
  resolveMember: MemberResolver,
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
    {
      method: 'POST',
      path: '/api/v1/check-in-tokens',
      tenantScoped: true,
      // El token sale de la sesion de quien pide: un atacante que llame a esto
      // solo se emite un QR para si mismo, y sin ficha no llega ni a eso.
      isolationFixture: () => Promise.resolve({ path: '/api/v1/check-in-tokens', body: {} }),
      summary: 'Emitir mi QR de ingreso',
      tags: ['attendance'],
      permission: { booking: ['read'] },
      response: { status: 201, schema: qrTokenSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/check-in-tokens/redeem',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/check-in-tokens/redeem',
          body: { token: 'un-token-de-otro-centro-que-no-existe' },
        }),
      summary: 'Canjear un QR en la puerta',
      tags: ['attendance'],
      permission: { attendance: ['checkIn'] },
      request: { body: redeemQrSchema },
      response: { status: 200, schema: checkInResultSchema },
      errorCodes: [
        'LP-ATTD-422-004',
        'LP-ATTD-404-005',
        'LP-ATTD-422-002',
        'LP-ATTD-403-003',
        'LP-SYS-422-006',
      ],
    },
    {
      method: 'POST',
      path: '/api/v1/sessions/:sessionId/walk-in',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => ({
        path: `/api/v1/sessions/${(await seedVictim(victimTenantId)).sessionId}/walk-in`,
        body: { memberId: 'mem_victima' },
      }),
      summary: 'Registrar a alguien que llego sin reserva',
      tags: ['attendance'],
      permission: { attendance: ['checkIn'] },
      request: { params: sessionParams, body: walkInSchema },
      response: { status: 201, schema: bookingResultSchema },
      errorCodes: [
        'LP-BOOK-404-006',
        'LP-BOOK-409-001',
        'LP-BOOK-409-002',
        'LP-ATTD-422-002',
        'LP-ATTD-403-003',
        'LP-CTRT-402-001',
        'LP-CTRT-402-002',
        'LP-SYS-422-006',
      ],
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
    routes.use('/api/v1/sessions/:sessionId/walk-in', guard);
    routes.use('/api/v1/check-in-tokens', guard);
    routes.use('/api/v1/check-in-tokens/*', guard);
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

      return c.json(toCheckInResponse(entrada));
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

  /*
   * §2.1.18: el QR se emite a pedido y vale 30 segundos. Es de quien lo pide —la
   * ficha sale de su sesion—, asi que no hay `memberId` en el cuerpo.
   */
  routes.post('/api/v1/check-in-tokens', requirePermission({ booking: ['read'] }), async (c) => {
    const userId = c.get('userId') as string;
    const memberId = await resolveMember(userId);
    if (!memberId) throw memberNotFound();

    return c.json(await service.issueQrToken(memberId, userId), 201);
  });

  routes.post(
    '/api/v1/check-in-tokens/redeem',
    requirePermission({ attendance: ['checkIn'] }),
    requireIdempotencyKey,
    validated<RedeemQrInput, AppEnv>(redeemQrSchema, async (c, input) =>
      c.json(
        toCheckInResponse(
          await service.redeemQrToken(input.token, c.get('userId') as string, input.sessionId),
        ),
      ),
    ),
  );

  /*
   * El walk-in es el unico camino donde el credito se descuenta en el check-in y
   * no al reservar (fila 7 de §2.1.9).
   */
  routes.post(
    '/api/v1/sessions/:sessionId/walk-in',
    requirePermission({ attendance: ['checkIn'] }),
    requireIdempotencyKey,
    validated<WalkInInput, AppEnv>(walkInSchema, async (c, input) =>
      c.json(
        await service.walkIn(
          c.req.param('sessionId') as string,
          input.memberId,
          c.get('userId') as string,
          c.get('idempotencyKey') as string,
        ),
        201,
      ),
    ),
  );

  return routes;
}

/** La forma del check-in en la respuesta, igual para el coach y para el QR. */
function toCheckInResponse(entrada: {
  publicId: string;
  sessionId: string;
  memberId: string;
  status: string;
  checkedInAt: { toString(): string } | null;
  checkInMethod: string | null;
}) {
  return {
    bookingId: entrada.publicId,
    sessionId: entrada.sessionId,
    memberId: entrada.memberId,
    status: entrada.status,
    checkedInAt: entrada.checkedInAt?.toString() ?? null,
    checkInMethod: entrada.checkInMethod,
  };
}

/** Sin ficha en el centro no hay QR que emitir. */
function memberNotFound(): AppError {
  return new AppError({
    code: 'LP-MEMB-404-003',
    status: 404,
    message: 'No encontramos tu ficha de socio en este centro.',
    action: 'Pedile al centro que te asocie con un codigo de invitacion.',
  });
}
