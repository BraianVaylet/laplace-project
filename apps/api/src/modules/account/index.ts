import { Hono } from 'hono';
import type { Temporal } from '@js-temporal/polyfill';
import {
  avatarUploadedSchema,
  deletionRequestResultSchema,
  deletionRequestSchema,
  myContractSchema,
  myDataExportSchema,
  myProfileSchema,
  updateMyProfileSchema,
  type DeletionRequestInput,
  type UpdateMyProfileInput,
} from '@laplace/schemas';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { requireOrganization, requirePermission } from '../../auth/organization.js';
import { requireSession } from '../../auth/session.js';
import { AppError } from '../../http/errors.js';
import { registerRoutes } from '../../http/route-registry.js';
import { validated } from '../../http/validate.js';
import { tenantContext } from '../../tenancy/middleware.js';
import { MAX_IMAGE_BYTES } from './domain/image.js';
import { AccountService } from './application/account-service.js';
import type {
  MyBookingLookup,
  MyConsentLookup,
  MyContractLookup,
  MyMemberLookup,
  ObjectStorage,
} from './application/ports.js';

/**
 * Interfaz publica del modulo Account: lo del socio sobre lo suyo (§2.1.2,
 * §9.2).
 *
 * 🔴 **Ninguna ruta de acá acepta un `memberId`.** Se resuelve siempre desde la
 * sesion: aceptarlo por parametro dejaria a un socio pedir el perfil o los
 * packs del companero de al lado, y el aislamiento por tenant no lo taparia
 * porque los dos son del mismo centro.
 */
export interface AccountModule {
  routes: Hono<AppEnv>;
  service: AccountService;
}

/** Quien es el socio de esta sesion. Lo resuelve Members. */
export type MemberResolver = (userId: string) => Promise<string | null>;

export interface AccountModuleDeps {
  members: MyMemberLookup;
  contracts: MyContractLookup;
  bookings: MyBookingLookup;
  consents: MyConsentLookup;
  storage: ObjectStorage;
  resolveMember: MemberResolver;
  now: () => Temporal.Instant;
}

export function createAccountModule(deps: AccountModuleDeps): AccountModule {
  const service = new AccountService({
    members: deps.members,
    contracts: deps.contracts,
    bookings: deps.bookings,
    consents: deps.consents,
    storage: deps.storage,
    now: deps.now,
  });

  registerRoutes([
    {
      method: 'GET',
      path: '/api/v1/my/contracts',
      tenantScoped: true,
      // Sin ficha en este centro, la lista sale vacia: no hay nada del tenant
      // victima que un atacante sin ficha pueda ver aca.
      isolationFixture: () => Promise.resolve({ path: '/api/v1/my/contracts' }),
      summary: 'Mis packs: qué me queda y hasta cuándo',
      tags: ['account'],
      permission: { booking: ['read'] },
      response: { status: 200, schema: z.array(myContractSchema) },
      errorCodes: ['LP-AUTH-403-002'],
    },
    {
      method: 'GET',
      path: '/api/v1/my/profile',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/my/profile' }),
      summary: 'Mi perfil',
      tags: ['account'],
      permission: { booking: ['read'] },
      response: { status: 200, schema: myProfileSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'PATCH',
      path: '/api/v1/my/profile',
      tenantScoped: true,
      isolationFixture: () =>
        Promise.resolve({ path: '/api/v1/my/profile', body: { phone: '+542914000000' } }),
      summary: 'Editar mis datos y mi contacto de emergencia',
      tags: ['account'],
      permission: { booking: ['read'] },
      request: { body: updateMyProfileSchema },
      response: { status: 200, schema: myProfileSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-SYS-422-006', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/my/avatar',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/my/avatar', body: {} }),
      summary: 'Subir mi foto de perfil',
      tags: ['account'],
      permission: { booking: ['read'] },
      response: { status: 200, schema: avatarUploadedSchema },
      errorCodes: ['LP-ACCT-422-001', 'LP-ACCT-413-002', 'LP-MEMB-404-003'],
    },
    {
      method: 'GET',
      path: '/api/v1/my/data',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/my/data' }),
      summary: 'Exportar todos mis datos (Ley 25.326)',
      tags: ['account'],
      permission: { booking: ['read'] },
      response: { status: 200, schema: myDataExportSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
    {
      method: 'POST',
      path: '/api/v1/my/deletion-request',
      tenantScoped: true,
      isolationFixture: () => Promise.resolve({ path: '/api/v1/my/deletion-request', body: {} }),
      summary: 'Pedir la baja de mis datos',
      tags: ['account'],
      permission: { booking: ['read'] },
      request: { body: deletionRequestSchema },
      response: { status: 200, schema: deletionRequestResultSchema },
      errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
    },
  ]);

  const routes = new Hono<AppEnv>();

  for (const prefijo of ['/api/v1/my/*'] as const) {
    routes.use(prefijo, requireSession);
    routes.use(prefijo, requireOrganization);
    routes.use(prefijo, tenantContext);
  }

  /**
   * 🔴 La ficha sale de la sesion, siempre. Es la unica forma de que un socio
   * no pueda pedir lo de otro.
   */
  const miFicha = async (c: { get: (key: 'userId') => unknown }): Promise<string> => {
    const memberId = await deps.resolveMember(c.get('userId') as string);
    if (memberId) return memberId;

    throw new AppError({
      code: 'LP-MEMB-404-003',
      status: 404,
      message: 'No encontramos tu ficha de socio en este centro.',
      action: 'Pedile al centro que te asocie con un código de invitación.',
    });
  };

  routes.get('/api/v1/my/contracts', requirePermission({ booking: ['read'] }), async (c) =>
    c.json(await service.myContracts(await miFicha(c))),
  );

  routes.get('/api/v1/my/profile', requirePermission({ booking: ['read'] }), async (c) =>
    c.json(await service.myProfile(await miFicha(c))),
  );

  routes.patch(
    '/api/v1/my/profile',
    requirePermission({ booking: ['read'] }),
    validated<UpdateMyProfileInput, AppEnv>(updateMyProfileSchema, async (c, input) =>
      c.json(await service.updateMyProfile(await miFicha(c), input)),
    ),
  );

  routes.post('/api/v1/my/avatar', requirePermission({ booking: ['read'] }), async (c) => {
    const memberId = await miFicha(c);

    /*
     * Se lee el cuerpo crudo y se mira el contenido: el `Content-Type` que
     * viene en el pedido lo escribe quien sube el archivo y no prueba nada.
     * El limite tambien se chequea aca, antes de tocar el almacenamiento.
     */
    const buffer = await c.req.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new AppError({
        code: 'LP-ACCT-413-002',
        status: 413,
        message: `La imagen supera el máximo de ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
        meta: { bytes: buffer.byteLength },
      });
    }

    return c.json(await service.uploadAvatar(memberId, new Uint8Array(buffer)));
  });

  routes.get('/api/v1/my/data', requirePermission({ booking: ['read'] }), async (c) =>
    c.json(await service.exportMyData(await miFicha(c))),
  );

  routes.post(
    '/api/v1/my/deletion-request',
    requirePermission({ booking: ['read'] }),
    validated<DeletionRequestInput, AppEnv>(deletionRequestSchema, async (c, input) =>
      c.json(await service.requestDeletion(await miFicha(c), input)),
    ),
  );

  return { routes, service };
}

export type { AccountService } from './application/account-service.js';
export type {
  MyBookingLookup,
  MyConsentLookup,
  MyContractLookup,
  MyMemberLookup,
  ObjectStorage,
} from './application/ports.js';
export {
  createInMemoryObjectStorage,
  randomSigningSecret,
} from './infrastructure/object-storage.js';
