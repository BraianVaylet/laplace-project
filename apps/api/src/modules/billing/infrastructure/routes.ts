import { Hono } from 'hono';
import { z } from 'zod';
import {
  accountStatementSchema,
  chargeSchema,
  tillSummarySchema,
  createChargeSchema,
  paymentSchema,
  refundPaymentSchema,
  registerPaymentSchema,
  type CreateChargeInput,
  type RefundPaymentInput,
  type RegisterPaymentInput,
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
import { registerRoutes, type IsolationFixture } from '../../../http/route-registry.js';
import { validated } from '../../../http/validate.js';
import { tenantContext } from '../../../tenancy/middleware.js';
import { Temporal } from '@js-temporal/polyfill';
import type { BillingService } from '../application/billing-service.js';
import { tillToCsv } from '../domain/billing.js';

const idParams = z.object({ id: z.string() });
const memberParams = z.object({ memberId: z.string() });
/** `format=csv` devuelve el arqueo para pegarlo en la planilla del centro. */
const tillQuery = z.object({
  /** `YYYY-MM-DD` en la zona del Venue. Sin valor, hoy. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.')
    .optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

const voidChargeSchema = z.object({
  reason: z.string().trim().min(5, 'Escribí el motivo de la anulación.').max(300),
});

/** Descripción del cargo sembrado por los fixtures. No puede aparecer en ninguna respuesta ajena. */
export const VICTIM_CHARGE_DESCRIPTION = 'Cargo del otro centro';

export function createBillingRoutes(
  service: BillingService,
  entitlements: EntitlementsLoader,
  /** La zona horaria de la sede. El día de la caja es el del centro (§2.1.2). */
  venues: { timeZoneOf(venueId: string): Promise<string> },
  seedVictim: (victimTenantId: string) => Promise<{ chargeId: string; memberId: string }>,
) {
  const attackCharge: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/charges/${(await seedVictim(victimTenantId)).chargeId}/void`,
    body: { reason: 'Sonda de aislamiento.' },
  });

  const attackStatement: IsolationFixture = async ({ victimTenantId }) => ({
    path: `/api/v1/members/${(await seedVictim(victimTenantId)).memberId}/statement`,
  });

  registerRoutes([
    {
      method: 'POST',
      path: '/api/v1/charges',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/charges',
          body: {
            memberId: 'mem_x',
            venueId: 'ven_x',
            amountCents: 1000,
            description: 'Sonda de aislamiento',
          },
        }),
      summary: 'Generar un cargo',
      tags: ['billing'],
      permission: { billing: ['charge'] },
      request: { body: createChargeSchema },
      response: { status: 201, schema: chargeSchema },
      errorCodes: ['LP-BILL-422-003', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/charges/:id/void',
      tenantScoped: true,
      isolationFixture: attackCharge,
      summary: 'Anular un cargo, con motivo',
      tags: ['billing'],
      permission: { billing: ['refund'] },
      request: { params: idParams, body: voidChargeSchema },
      response: { status: 200, schema: chargeSchema },
      errorCodes: ['LP-BILL-404-004', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/payments',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({
          path: '/api/v1/payments',
          body: { memberId: 'mem_x', venueId: 'ven_x', amountCents: 1000, method: 'cash' },
        }),
      summary: 'Registrar un pago',
      tags: ['billing'],
      permission: { billing: ['collect'] },
      request: { body: registerPaymentSchema },
      response: { status: 201, schema: paymentSchema },
      errorCodes: ['LP-BILL-409-002', 'LP-BILL-422-003', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/payments/:id/refund',
      tenantScoped: true,
      isolationFixture: async (context) => ({
        path: `/api/v1/payments/${(await seedVictim(context.victimTenantId)).chargeId}/refund`,
        body: { reason: 'Sonda de aislamiento.' },
      }),
      summary: 'Anular un pago con un reembolso',
      tags: ['billing'],
      // Reembolsar es sacar plata de la caja: no es del mostrador.
      permission: { billing: ['refund'] },
      request: { params: idParams, body: refundPaymentSchema },
      response: { status: 200, schema: paymentSchema },
      errorCodes: ['LP-BILL-404-004', 'LP-BILL-409-005', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/venues/:venueId/till',
      tenantScoped: true,
      isolationFixture: async ({ victimTenantId }) => {
        await seedVictim(victimTenantId);
        return { path: '/api/v1/venues/ven_victima/till?date=2026-03-15' };
      },
      summary: 'Arqueo de caja del día en una sede',
      tags: ['billing'],
      // Es la plata del día: lo ve quien cobra, no cualquiera con acceso.
      permission: { billing: ['read'] },
      request: { params: z.object({ venueId: z.string() }), query: tillQuery },
      response: { status: 200, schema: tillSummarySchema },
      errorCodes: ['LP-SYS-404-002', 'LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/members/:memberId/statement',
      tenantScoped: true,
      isolationFixture: attackStatement,
      summary: 'Estado de cuenta del socio',
      tags: ['billing'],
      permission: { billing: ['read'] },
      request: { params: memberParams },
      response: { status: 200, schema: accountStatementSchema },
      errorCodes: ['LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  const guards = [
    requireSession,
    requireOrganization,
    tenantContext,
    entitlementsContext(entitlements),
    requireModule('billing'),
  ] as const;

  for (const guard of guards) {
    routes.use('/api/v1/venues/:venueId/till', guard);
    for (const path of [
      '/api/v1/charges',
      '/api/v1/charges/*',
      '/api/v1/payments',
      '/api/v1/payments/*',
    ]) {
      routes.use(path, guard);
    }
    routes.use('/api/v1/members/:memberId/statement', guard);
  }

  routes.post(
    '/api/v1/charges',
    requirePermission({ billing: ['charge'] }),
    validated<CreateChargeInput, AppEnv>(createChargeSchema, async (c, input) =>
      c.json(await service.createCharge(input), 201),
    ),
  );

  routes.post(
    '/api/v1/charges/:id/void',
    requirePermission({ billing: ['refund'] }),
    validated<{ reason: string }, AppEnv>(voidChargeSchema, async (c, input) =>
      c.json(await service.voidCharge(c.req.param('id') as string, input.reason)),
    ),
  );

  routes.post(
    '/api/v1/payments',
    requirePermission({ billing: ['collect'] }),
    // §5.0: idempotencia obligatoria en pagos. Sin la clave, el reintento de un
    // pago que falló por timeout cobra dos veces.
    requireIdempotencyKey,
    validated<RegisterPaymentInput, AppEnv>(registerPaymentSchema, async (c, input) =>
      // `requireIdempotencyKey` corre antes: acá la clave siempre existe.
      c.json(await service.registerPayment(input, c.get('idempotencyKey') as string), 201),
    ),
  );

  routes.post(
    '/api/v1/payments/:id/refund',
    requirePermission({ billing: ['refund'] }),
    validated<RefundPaymentInput, AppEnv>(refundPaymentSchema, async (c, input) =>
      c.json(await service.refundPayment(c.req.param('id') as string, input)),
    ),
  );

  routes.get(
    '/api/v1/venues/:venueId/till',
    requirePermission({ billing: ['read'] }),
    async (c) => {
      const venueId = c.req.param('venueId');
      const { date, format } = tillQuery.parse(c.req.query());
      const timeZone = await venues.timeZoneOf(venueId);

      // El dia es el DEL CENTRO: calculado en UTC, la caja de un centro argentino
      // cerraria a las 21:00 y los pagos de la ultima hora caerian en el dia
      // siguiente.
      const summary = await service.till(venueId, date ?? todayIn(timeZone), timeZone);

      if (format !== 'csv') return c.json(summary);

      return new Response(tillToCsv(summary), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="caja-${summary.date}.csv"`,
        },
      });
    },
  );

  routes.get(
    '/api/v1/members/:memberId/statement',
    requirePermission({ billing: ['read'] }),
    async (c) => c.json(await service.statement(c.req.param('memberId'))),
  );

  return routes;
}

/** Hoy en la zona del centro, `YYYY-MM-DD`. */
function todayIn(timeZone: string): string {
  return Temporal.Now.plainDateISO(timeZone).toString();
}
