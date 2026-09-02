import { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { toBsonDate } from '../../persistence/bson-date.js';
import { runWithTenant } from '../../tenancy/context.js';
import { MemberService, type Today } from './application/member-service.js';
import type { MemberDoc } from './infrastructure/member.model.js';
import { MemberRepository } from './infrastructure/member.repository.js';
import { VICTIM_MEMBER_NAME, createMemberRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Members. Es lo unico que puede tocar otro modulo:
 * el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface MembersModule {
  routes: ReturnType<typeof createMemberRoutes>;
  service: MemberService;
}

export interface MembersModuleDeps {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
  /** Se inyecta para poder testear la mayoria de edad sin viajar en el tiempo. */
  today?: Today | undefined;
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

  return { routes: createMemberRoutes(service, deps.entitlements, seedVictimMember), service };
}

export type { MemberService } from './application/member-service.js';
