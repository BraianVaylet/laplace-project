import { Hono } from 'hono';
import { fromBsonDate } from '../persistence/bson-date.js';
import { createAuditWriter } from '../audit/audit-log.js';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from 'pino';
import type { AppEnv } from '../app.js';
import type { EntitlementsLoader } from '../entitlements/middleware.js';
import type { DomainEventBus } from '../events/bus.js';
import { createMembersModule, type OrganizationMembershipPort } from './members/index.js';
import { createBillingModule } from './billing/index.js';
import { createAttendanceModule, type AttendanceBooking } from './attendance/index.js';
import { createBookingModule } from './booking/index.js';
import { createContractsModule, type FutureBookingReleaser } from './contracts/index.js';
import { createProductsModule } from './products/index.js';
import { createScheduleModule, type SessionBookingReleaser } from './schedule/index.js';
import { createRoomsModule, type FutureSessionCounter } from './rooms/index.js';
import { createVenuesModule } from './venues/index.js';
import { createWaiverModule } from './waivers/index.js';
import {
  createLoggingMailer,
  createNotificationModule,
  type NotificationMailer,
} from './notifications/index.js';

export interface ModuleDeps {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
  logger: Logger;
  /**
   * Cuantas sesiones futuras tiene una sala. Lo va a contestar Schedule (F1-12);
   * hasta entonces el default responde 0 y el bloqueo de borrado no aplica.
   */
  sessions?: FutureSessionCounter | undefined;
  /** Hoy en `YYYY-MM-DD`. Se inyecta para poder testear la mayoria de edad. */
  today?: (() => string) | undefined;
  /** Reloj del canje de codigos. Se inyecta para probar el vencimiento sin esperar. */
  now?: (() => Temporal.Instant) | undefined;
  /**
   * Suma un usuario a la organizacion de un centro. Lo implementa Better Auth
   * desde `index.ts`: los modulos no conocen la libreria de identidad.
   */
  memberships: OrganizationMembershipPort;
  /**
   * Libera las reservas futuras de un contrato al congelarlo o vencerlo. Lo va a
   * contestar Booking (F1-14); hasta entonces no hay reservas que liberar.
   */
  bookings?: FutureBookingReleaser | undefined;
  /**
   * Libera las reservas de una clase cancelada y devuelve sus creditos. Lo va a
   * contestar Booking (F1-14); hasta entonces cancelar no libera nada.
   */
  sessionBookings?: SessionBookingReleaser | undefined;
  /**
   * El proveedor de mail de Notifications. Se inyecta para que ningun test
   * mande un mail; sin nada, deja el aviso en el log (modo dev).
   */
  mailer?: NotificationMailer | undefined;
}

/**
 * Punto de composicion del monolito modular. Cada modulo se arma aca y expone
 * sus rutas; nadie importa el modelo ni el repositorio de otro (ADR-003).
 *
 * Los modulos que dependen de otro reciben su **interfaz**, no su
 * implementacion: Rooms pregunta si una sede existe a traves de `VenueLookup`,
 * que hoy contesta Venues y mañana podria contestar otra cosa.
 */
export function createModules(deps: ModuleDeps) {
  const routes = new Hono<AppEnv>();

  const audit = createAuditWriter();

  const venues = createVenuesModule(deps);
  const rooms = createRoomsModule({
    ...deps,
    venues: { exists: (venueId) => venues.service.exists(venueId) },
    /*
     * Salda la deuda de F1-02: el bloqueo de borrado de una sala con clases
     * programadas ya no responde 0, lo contesta Schedule de verdad.
     *
     * Un `sessions` explicito gana: es el que le deja a un test probar la logica
     * de Rooms sin montar la agenda entera.
     */
    sessions: deps.sessions ?? {
      countFutureSessions: (roomId) => schedule.service.countFutureSessions(roomId),
    },
  });

  const schedule = createScheduleModule({
    entitlements: deps.entitlements,
    events: deps.events,
    audit,
    rooms: { capacityOf: (roomId) => rooms.service.capacityOf(roomId) },
    venues: { timeZoneOf: (venueId) => venues.service.timeZoneOf(venueId) },
    /*
     * Cancelar una clase devuelve los creditos de sus inscriptos (§2.1.9). Lo
     * contesta Booking (F1-14); hasta entonces no hay reservas que liberar.
     */
    /*
     * Salda la deuda de F1-13: cancelar una clase ahora libera de verdad sus
     * reservas y devuelve los creditos, en una transaccion.
     */
    bookings: deps.sessionBookings ?? {
      releaseSession: (params) => booking.service.releaseSession(params),
    },
    ...(deps.now ? { now: deps.now } : {}),
  });

  const members = createMembersModule(deps);
  /*
   * Products y Contracts se necesitan mutuamente: Contracts pregunta si se puede
   * vender, y Products pregunta si esa persona ya uso su clase de prueba. Se
   * resuelve con dos interfaces y un `lazy` de un lado, no importandose entre si
   * (ADR-003).
   */
  const products = createProductsModule({
    ...deps,
    purchases: { hasUsedTrial: (memberId) => contracts.service.hasUsedTrial(memberId) },
  });

  const contracts = createContractsModule({
    ...deps,
    audit,
    products: {
      assertPurchasable: async (productId, memberId) => {
        const product = await products.service.assertPurchasable(productId, memberId);

        return {
          publicId: String(product['publicId']),
          name: product.name,
          type: product.type as never,
          priceCents: product.priceCents,
          currency: product.currency,
          credits: product.credits,
          durationDays: product.durationDays,
          weeklyLimit: product.weeklyLimit,
          monthlyLimit: product.monthlyLimit,
          allowedCategories: product.allowedCategories,
          allowedTimeRanges: product.allowedTimeRanges,
          autoRenew: product.autoRenew,
        };
      },
      registerSale: (productId) => products.service.registerSale(productId),
      releaseSale: (productId) => products.service.releaseSale(productId),
    },
    venues: {
      timeZoneOf: (venueId) => venues.service.timeZoneOf(venueId),
      maxFreezeDaysOf: (venueId) => venues.service.maxFreezeDaysOf(venueId),
    },
    /*
     * Salda la deuda de F1-09: congelar o vencer un contrato ahora libera de
     * verdad las reservas futuras y devuelve sus creditos, en una transaccion.
     */
    bookings: deps.bookings ?? {
      releaseFuture: (params) => booking.service.releaseFuture(params),
    },
  });

  const billing = createBillingModule({
    ...deps,
    audit,
    /*
     * El saldo del socio se guarda tambien en su ficha, para no recalcularlo por
     * cada fila del listado. La fuente de verdad sigue siendo el estado de
     * cuenta, que se calcula sobre cargos y pagos.
     */
    members: {
      set: (memberId, balanceCents) => members.service.setBalance(memberId, balanceCents),
    },
    venues: { timeZoneOf: (venueId) => venues.service.timeZoneOf(venueId) },
  });

  /*
   * Booking orquesta: toma el lugar en Schedule, descuenta el credito en
   * Contracts y consulta la mora en Billing. Cada pieza la resuelve el modulo
   * que la conoce, y Booking solo las ordena (ADR-003).
   */
  const booking = createBookingModule({
    entitlements: deps.entitlements,
    events: deps.events,
    sessions: {
      claimSeat: (sessionId) => toClaimed(schedule.service.claimSeat(sessionId), venues.service),
      releaseSeat: (sessionId) => schedule.service.releaseSeat(sessionId),
      adjustWaitlist: (sessionId, delta) => schedule.service.adjustWaitlist(sessionId, delta),
      find: (sessionId) => toClaimed(schedule.service.findSession(sessionId), venues.service),
    },
    credits: {
      consume: (memberId, context) => contracts.service.consume(memberId, context),
      refund: async (contractId) => {
        await contracts.service.refund(contractId);
      },
    },
    arrears: {
      assertCanTransact: (memberId, allowDebt) =>
        billing.service.assertCanTransact(memberId, allowDebt),
    },
    venues: { policyOf: (venueId, categoryId) => venues.service.policyOf(venueId, categoryId) },
    members: (userId) => members.service.findIdByUserId(userId),
    history: {
      startedBetweenAcrossTenants: (from, to) =>
        schedule.service.startedBetweenAcrossTenants(from, to),
    },
    penalties: {
      registerNoShow: (memberId, blockedUntil) =>
        members.service.registerNoShow(memberId, blockedUntil),
      bookingBlockedUntil: (memberId) => members.service.bookingBlockedUntil(memberId),
    },
    now: deps.now ?? (() => Temporal.Now.instant()),
  });

  routes.route('/', venues.routes);
  routes.route('/', rooms.routes);
  routes.route('/', members.routes);
  routes.route('/', products.routes);
  routes.route('/', contracts.routes);
  routes.route('/', billing.routes);
  routes.route('/', schedule.routes);

  /*
   * Waivers va antes que Attendance: el check-in necesita preguntarle "¿le
   * falta algo obligatorio a este socio?" (WaiverGate), y esa pregunta la
   * contesta este modulo.
   */
  const waivers = createWaiverModule({
    entitlements: deps.entitlements,
    events: deps.events,
    now: deps.now ?? (() => Temporal.Now.instant()),
    members: {
      contextOf: (memberId) => members.service.waiverContextOf(memberId),
      memberOf: (userId) => members.service.findByUserId(userId),
    },
    resolveMember: (userId) => members.service.findIdByUserId(userId),
  });

  routes.route('/', waivers.routes);

  /*
   * Attendance orquesta y no guarda: la reserva la escribe Booking, la clase la
   * conoce Schedule y la ficha la guarda Members. La asistencia es un estado de
   * la reserva, y duplicarla en otra coleccion serian dos verdades sobre si
   * alguien entro (ADR-003).
   */
  const attendance = createAttendanceModule({
    entitlements: deps.entitlements,
    events: deps.events,
    now: deps.now ?? (() => Temporal.Now.instant()),
    waivers: { missingFor: (memberId) => waivers.service.missingFor(memberId) },
    bookings: {
      find: async (bookingId) => {
        const reserva = await booking.service.findOne(bookingId);

        return reserva ? toAttendanceBooking(reserva) : null;
      },
      ofSession: async (sessionId) =>
        (await booking.service.ofSession(sessionId)).map(toAttendanceBooking),
      awaitingCheckInOf: async (memberId) =>
        (await booking.service.awaitingCheckInOf(memberId)).map(toAttendanceBooking),
      markCheckedIn: async (bookingId, data) =>
        toAttendanceBooking(await booking.service.markCheckedIn(bookingId, data)),
      createWalkIn: (data) => booking.service.walkIn(data),
    },
    sessions: {
      find: async (sessionId) => {
        const clase = await schedule.service.findSession(sessionId);
        if (!clase) return null;

        return {
          publicId: String(clase['publicId']),
          name: clase.name,
          venueId: clase.venueId,
          categoryId: clase.categoryId,
          startAt: fromBsonDate(clase.startAt),
          endAt: fromBsonDate(clase.endAt),
          capacity: clase.capacity,
          status: clase.status,
          timeZone: await venues.service.timeZoneOf(clase.venueId),
        };
      },
    },
    members: {
      summariesOf: (memberIds) => members.service.summariesOf(memberIds),
      recordAttendance: (memberId, at) => members.service.recordAttendance(memberId, at),
    },
    arrears: {
      assertCanTransact: (memberId, allowDebt) =>
        billing.service.assertCanTransact(memberId, allowDebt),
    },
    venues: {
      policyFor: (venueId, categoryId) => venues.service.policyOf(venueId, categoryId),
    },
    resolveMember: (userId) => members.service.findIdByUserId(userId),
    seedVictim: async (victimTenantId) => ({
      sessionId: (await schedule.seedVictim(victimTenantId)).sessionId,
      bookingId: await booking.seedVictim(victimTenantId),
    }),
  });

  routes.route('/', booking.routes);
  routes.route('/', attendance.routes);

  /*
   * Notifications va ultimo y no lo conoce nadie: se engancha a los eventos que
   * los demas ya emiten (ADR-003). Que el aviso falle no puede romper la
   * reserva que lo origino, y por eso no hay ninguna llamada directa hacia aca.
   */
  const notifications = createNotificationModule({
    entitlements: deps.entitlements,
    events: deps.events,
    now: deps.now ?? (() => Temporal.Now.instant()),
    mailer: deps.mailer ?? createLoggingMailer((msg, meta) => deps.logger.info(meta, msg)),
    recipients: {
      byMemberId: (memberId) => members.service.notificationRecipientOf(memberId),
    },
    sessions: {
      find: async (sessionId) => {
        const clase = await schedule.service.findSession(sessionId);
        if (!clase) return null;

        return {
          name: clase.name,
          venueId: clase.venueId,
          startAt: fromBsonDate(clase.startAt),
        };
      },
    },
    venues: { find: (venueId) => venues.service.summaryOf(venueId) },
    roster: {
      of: async (sessionId) =>
        (await booking.service.ofSession(sessionId)).map((reserva) => ({
          memberId: reserva.memberId,
          status: reserva.status,
        })),
    },
    contracts: { find: (contractId) => contracts.service.notificationContextOf(contractId) },
    charges: { find: (chargeId) => billing.service.chargeContextOf(chargeId) },
    payments: { find: (paymentId) => billing.service.paymentContextOf(paymentId) },
    upcoming: {
      startingBetween: (from, to) => schedule.service.startedBetweenAcrossTenants(from, to),
    },
  });

  routes.route('/', notifications.routes);

  /** Todo lo que el runner tiene que programar (§10). */
  const jobs = [
    ...contracts.jobs,
    ...billing.jobs,
    ...schedule.jobs,
    ...booking.jobs,
    ...notifications.jobs,
  ];

  return {
    routes,
    jobs,
    venues,
    rooms,
    members,
    products,
    contracts,
    billing,
    schedule,
    booking,
    waivers,
    attendance,
    notifications,
  };
}

/**
 * Solo las rutas. Es lo que necesita `createApp`; los modulos enteros los usan
 * los tests y las tareas que orquestan varios (F1-14 en adelante).
 */
export function createModuleRoutes(deps: ModuleDeps): Hono<AppEnv> {
  return createModules(deps).routes;
}

/**
 * El documento de la clase a lo que Booking necesita saber de ella.
 *
 * La zona horaria se resuelve al vuelo contra el Venue: es contra la hora
 * **local** que se evalua la franja horaria de un pack (§2.1.9), asi que
 * resolverla en UTC dejaria pasar reservas que el pack matutino no cubre.
 */
async function toClaimed(
  pending: Promise<{
    publicId?: unknown;
    venueId: string;
    categoryId: string;
    startAt: Date;
    endAt: Date;
    capacity: number;
    bookedCount: number;
    status: string;
  } | null>,
  venues: { timeZoneOf(venueId: string): Promise<string> },
) {
  const session = await pending;
  if (!session) return null;

  return {
    publicId: String(session.publicId),
    venueId: session.venueId,
    categoryId: session.categoryId,
    startAt: fromBsonDate(session.startAt),
    endAt: fromBsonDate(session.endAt),
    capacity: session.capacity,
    bookedCount: session.bookedCount,
    status: session.status,
    timeZone: await venues.timeZoneOf(session.venueId),
  };
}

/**
 * La reserva, como la ve Attendance. Convierte las fechas de BSON a Temporal
 * en el borde: adentro del modulo no hay `Date` (§3.1).
 */
function toAttendanceBooking(booking: {
  publicId?: unknown;
  sessionId: string;
  memberId: string;
  venueId: string;
  status: string;
  waitlistPosition?: number | null;
  checkedInAt?: Date | null;
  checkInMethod?: string | null;
}): AttendanceBooking {
  return {
    publicId: String(booking.publicId),
    sessionId: booking.sessionId,
    memberId: booking.memberId,
    venueId: booking.venueId,
    status: booking.status,
    waitlistPosition: booking.waitlistPosition ?? null,
    checkedInAt: booking.checkedInAt ? fromBsonDate(booking.checkedInAt) : null,
    checkInMethod: (booking.checkInMethod ?? null) as AttendanceBooking['checkInMethod'],
  };
}
