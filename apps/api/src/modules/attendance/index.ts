import type { Temporal } from '@js-temporal/polyfill';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import {
  AttendanceService,
  type AttendanceArrears,
  type AttendanceBookings,
  type AttendanceMembers,
  type AttendanceSessions,
  type VenuePolicyPort,
  type WaiverGate,
} from './application/attendance-service.js';
import { createAttendanceRoutes } from './infrastructure/routes.js';

/**
 * Interfaz publica del modulo Attendance (ADR-003).
 *
 * No tiene repositorio propio: la asistencia es un estado de la reserva, y
 * duplicarla en otra coleccion seria tener dos verdades sobre si alguien entro.
 * Lo que aporta el modulo es la decision y la vista del coach.
 */
export interface AttendanceModule {
  routes: ReturnType<typeof createAttendanceRoutes>;
  service: AttendanceService;
}

export interface AttendanceModuleDeps {
  entitlements: EntitlementsLoader;
  events: DomainEventBus;
  bookings: AttendanceBookings;
  sessions: AttendanceSessions;
  members: AttendanceMembers;
  arrears: AttendanceArrears;
  venues: VenuePolicyPort;
  waivers?: WaiverGate | undefined;
  now: () => Temporal.Instant;
  /** Siembra la reserva del tenant victima para la suite de aislamiento (F0-05). */
  seedVictim: (victimTenantId: string) => Promise<{ sessionId: string; bookingId: string }>;
}

export function createAttendanceModule(deps: AttendanceModuleDeps): AttendanceModule {
  const service = new AttendanceService({
    bookings: deps.bookings,
    sessions: deps.sessions,
    members: deps.members,
    arrears: deps.arrears,
    venues: deps.venues,
    events: deps.events,
    now: deps.now,
    ...(deps.waivers ? { waivers: deps.waivers } : {}),
  });

  return {
    routes: createAttendanceRoutes(service, deps.entitlements, deps.seedVictim),
    service,
  };
}

export type {
  AttendanceService,
  AttendanceBookings,
  AttendanceBooking,
  AttendanceSessions,
  AttendanceMembers,
  AttendanceArrears,
  VenuePolicyPort,
  WaiverGate,
} from './application/attendance-service.js';
