import { Hono } from 'hono';
import { Temporal } from '@js-temporal/polyfill';
import type { AppEnv } from '../../app.js';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { toBsonDate } from '../../persistence/bson-date.js';
import { runWithTenant } from '../../tenancy/context.js';
import { generateInviteCode } from './domain/invite-code.js';
import {
  InviteCodeService,
  type OrganizationMembershipPort,
} from './application/invite-code-service.js';
import { MemberService, type Today } from './application/member-service.js';
import type { MemberDoc } from './infrastructure/member.model.js';
import { InviteCodeRepository } from './infrastructure/invite-code.repository.js';
import { createInviteCodeRoutes } from './infrastructure/invite-code-routes.js';
import { MemberRepository } from './infrastructure/member.repository.js';
import { VICTIM_MEMBER_NAME, createMemberRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Members. Es lo unico que puede tocar otro modulo:
 * el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface MembersModule {
  routes: Hono<AppEnv>;
  service: MemberService;
  inviteCodes: InviteCodeService;
}

export interface MembersModuleDeps {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
  /** Se inyecta para poder testear la mayoria de edad sin viajar en el tiempo. */
  today?: Today | undefined;
  /** Reloj del canje. Se inyecta para probar el vencimiento sin esperar. */
  now?: (() => Temporal.Instant) | undefined;
  /**
   * Suma al usuario a la organizacion del centro. Lo contesta Better Auth desde
   * el punto de composicion: el modulo no conoce la libreria de identidad.
   */
  memberships: OrganizationMembershipPort;
}

/** Hoy en la zona del servidor. Cada Venue tiene la suya, pero la edad no depende de eso. */
const systemToday: Today = () => Temporal.Now.plainDateISO().toString();

export function createMembersModule(deps: MembersModuleDeps): MembersModule {
  const members = new MemberRepository();
  const service = new MemberService({
    members,
    events: deps.events,
    today: deps.today ?? systemToday,
  });

  /** Siembra un socio del tenant victima para la suite de aislamiento (F0-05). */
  const seedVictimMember = async (victimTenantId: string) => {
    const member = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        members.create({
          venueIds: ['ven_victima'],
          firstName: VICTIM_MEMBER_NAME,
          lastName: 'DelOtroCentro',
          status: 'active',
          flags: { debtor: false, suspended: false },
          tags: [],
          balanceCents: 0,
          joinedAt: toBsonDate(Temporal.Instant.fromEpochMilliseconds(0)),
          lastAttendanceAt: null,
          notes: [],
        } as unknown as Partial<MemberDoc>),
    );

    return String(member['publicId']);
  };

  const codes = new InviteCodeRepository();
  const inviteCodes = new InviteCodeService({
    codes,
    members,
    memberships: deps.memberships,
    ...(deps.now ? { now: deps.now } : {}),
  });

  /** Siembra un codigo del tenant victima para la suite de aislamiento (F0-05). */
  const seedVictimCode = async (victimTenantId: string) => {
    const created = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        codes.create({
          code: generateInviteCode(),
          venueId: 'ven_victima',
          maxUses: 10,
          usedCount: 0,
          expiresAt: toBsonDate(Temporal.Now.instant().add({ hours: 24 })),
          revokedAt: null,
        } as never),
    );

    return { id: String(created['publicId']), code: created['code'] as string };
  };

  const routes = new Hono<AppEnv>();
  routes.route('/', createMemberRoutes(service, deps.entitlements, seedVictimMember));
  routes.route('/', createInviteCodeRoutes(inviteCodes, deps.entitlements, seedVictimCode));

  return { routes, service, inviteCodes };
}

export type { MemberService } from './application/member-service.js';
export type {
  InviteCodeService,
  OrganizationMembershipPort,
} from './application/invite-code-service.js';
