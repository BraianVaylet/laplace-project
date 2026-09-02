import { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { toBsonDate } from '../../persistence/bson-date.js';
import { runWithTenant } from '../../tenancy/context.js';
import {
  BookingService,
  type ArrearsGate,
  type CreditLedger,
  type SessionSeats,
  type VenuePolicy,
} from './application/booking-service.js';
import type { BookingDoc } from './infrastructure/booking.model.js';
import { BookingRepository } from './infrastructure/booking.repository.js';
import { createBookingRoutes, type MemberResolver } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Booking. Es lo unico que puede tocar otro modulo:
 * el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface BookingModule {
  routes: ReturnType<typeof createBookingRoutes>;
  service: BookingService;
}

export interface BookingModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  sessions: SessionSeats;
  credits: CreditLedger;
  arrears: ArrearsGate;
  venues: VenuePolicy;
  members: MemberResolver;
  now: () => Temporal.Instant;
}

export function createBookingModule(deps: BookingModuleDeps): BookingModule {
  const bookings = new BookingRepository();
  const service = new BookingService({
    bookings,
    sessions: deps.sessions,
    credits: deps.credits,
    arrears: deps.arrears,
    venues: deps.venues,
    events: deps.events,
    now: deps.now,
  });

  /**
   * Siembra una reserva del tenant victima para la suite de aislamiento (F0-05).
   *
   * Cada llamada usa una clase y un socio distintos: el unico
   * `{ tenantId, sessionId, memberId }` es lo que impide la doble reserva, y
   * repetir el par haria fallar el propio fixture.
   */
  let sembradas = 0;
  const seedVictim = async (victimTenantId: string) => {
    const n = ++sembradas;
    const created = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        bookings.create({
          sessionId: `ses_victima_${n}`,
          memberId: `mem_victima_${n}`,
          venueId: 'ven_victima',
          status: 'booked',
          waitlistPosition: null,
          bookedAt: toBsonDate(Temporal.Now.instant()),
        } as Partial<BookingDoc>),
    );

    return String(created['publicId']);
  };

  return {
    routes: createBookingRoutes(service, deps.entitlements, deps.members, seedVictim),
    service,
  };
}

export type {
  BookingService,
  ArrearsGate,
  CreditLedger,
  SessionSeats,
  VenuePolicy,
} from './application/booking-service.js';
