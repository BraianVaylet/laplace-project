import { Hono } from 'hono';
import { z } from 'zod';
import {
  bookingResultSchema,
  bookingSchema,
  createBookingSchema,
  paginatedSchema,
  paginationQuerySchema,
  type CreateBookingInput,
} from '@laplace/schemas';
import type { AppEnv } from '../../../app.js';
import { authorize } from '../../../auth/permissions.js';
import { requireOrganization, requirePermission } from '../../../auth/organization.js';
import { requireSession } from '../../../auth/session.js';
import {
  entitlementsContext,
  requireModule,
  type EntitlementsLoader,
} from '../../../entitlements/middleware.js';
import { AppError } from '../../../http/errors.js';
import { requireIdempotencyKey } from '../../../http/idempotency.js';
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import type { BookingService } from '../application/booking-service.js';

const idParams = z.object({ id: z.string() });

/** Quien reserva, si el socio no es el que pide. Lo resuelve el modulo. */
export type MemberResolver = (userId: string) => Promise<string | null>;

export function createBookingRoutes(
  service: BookingService,
  entitlements: EntitlementsLoader,
  resolveMember: MemberResolver,
  seedVictim: (victimTenantId: string) => Promise<string>,
) {
  const attackBooking: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/bookings/${await seedVictim(victimTenantId)}`,
  });

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/bookings',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => {
        await seedVictim(victimTenantId);
        return { path: '/api/v1/bookings' };
      },
      summary: 'Mis reservas',
      tags: ['booking'],
      permission: { booking: ['read'] },
      request: { query: paginationQuerySchema },
      response: { status: 200, schema: paginatedSchema(bookingSchema) },
      errorCodes: ['LP-AUTH-403-002', 'LP-ENTL-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/bookings',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({ path: '/api/v1/bookings', body: { sessionId: 'ses_ajena' } }),
      summary: 'Reservar una clase',
      tags: ['booking'],
      permission: { booking: ['create'] },
      request: { body: createBookingSchema },
      response: { status: 201, schema: bookingResultSchema },
      errorCodes: [
        'LP-BOOK-409-001',
        'LP-BOOK-403-005',
        'LP-BOOK-404-006',
        'LP-BOOK-422-003',
        'LP-CTRT-402-001',
        'LP-CTRT-402-002',
        'LP-SYS-422-006',
        'LP-AUTH-403-002',
      ],
    },
    {
      method: 'GET',
      path: '/api/v1/bookings/:id',
      tenantScoped: true,
      isolationFixture: attackBooking,
      summary: 'Ver una reserva',
      tags: ['booking'],
      permission: { booking: ['read'] },
      request: { params: idParams },
      response: { status: 200, schema: bookingSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/bookings/:id/cancel',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `${(await attackBooking(context)).path}/cancel`,
      }),
      summary: 'Cancelar una reserva',
      tags: ['booking'],
      permission: { booking: ['cancel'] },
      request: { params: idParams },
      response: { status: 200, schema: bookingSchema },
      errorCodes: ['LP-BOOK-404-006', 'LP-BOOK-409-001', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('booking'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/bookings', guard);
    routes.use('/api/v1/bookings/*', guard);
  }

  /** El socio del pedido, o el que indica el staff si tiene permiso para eso. */
  const targetMember = async (
    c: {
      get: (key: 'userId' | 'org') => never;
      req: { param(name: string): string | undefined };
    },
    input: CreateBookingInput,
  ): Promise<string> => {
    const org = c.get('org') as unknown as { roles: string[] };
    const userId = c.get('userId') as unknown as string;

    if (input.memberId !== undefined) {
      // Reservar para otro es del mostrador, no del socio: sin este permiso
      // cualquiera podria gastarle el credito a cualquiera.
      if (!authorize(org.roles, { booking: ['createForOther'] })) {
        throw new AppError({
          code: 'LP-AUTH-403-002',
          status: 403,
          message: 'No tenés permisos para reservar en nombre de otra persona.',
        });
      }

      return input.memberId;
    }

    const propio = await resolveMember(userId);
    if (propio) return propio;

    throw new AppError({
      code: 'LP-MEMB-404-003',
      status: 404,
      message: 'No encontramos tu ficha de socio en este centro.',
      action: 'Pedile al centro que te asocie con un código de invitación.',
    });
  };

  routes.get('/api/v1/bookings', requirePermission({ booking: ['read'] }), async (c) => {
    const query = paginationQuerySchema.parse(c.req.query());
    const memberId = c.req.query('memberId') ?? (await resolveMember(c.get('userId') as string));
    if (!memberId) return c.json({ items: [], nextCursor: null });

    return c.json(await service.ofMember(memberId, query.cursor, query.limit));
  });

  routes.post(
    '/api/v1/bookings',
    requirePermission({ booking: ['create'] }),
    // §5.0: idempotencia obligatoria en reservas. Sin la clave, el reintento del
    // socio que tocó dos veces "Reservar" gasta dos créditos.
    requireIdempotencyKey,
    validated<CreateBookingInput, AppEnv>(createBookingSchema, async (c, input) => {
      const memberId = await targetMember(c as never, input);

      return c.json(await service.book(input, memberId, c.get('idempotencyKey') as string), 201);
    }),
  );

  routes.get('/api/v1/bookings/:id', requirePermission({ booking: ['read'] }), (c) =>
    service.get(c.req.param('id')).then((booking) => c.json(booking)),
  );

  routes.post('/api/v1/bookings/:id/cancel', requirePermission({ booking: ['cancel'] }), (c) =>
    service.cancel(c.req.param('id')).then((booking) => c.json(booking)),
  );

  return routes;
}
