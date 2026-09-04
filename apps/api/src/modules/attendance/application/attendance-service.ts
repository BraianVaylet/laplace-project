import { Temporal } from '@js-temporal/polyfill';
import type {
  BookingPolicy,
  BookingResult,
  BulkCheckInResult,
  CheckInMethod,
  ClassRoster,
  RosterAlert,
  RosterEntry,
} from '@laplace/schemas';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { assertWithinCheckInWindow, checkInWindowOf } from '../domain/check-in-window.js';
import {
  QR_TOKEN_TTL_SECONDS,
  assertTokenUsable,
  hashToken,
  newCheckInToken,
} from '../domain/qr-token.js';

/**
 * Casos de uso de Attendance (§2.1.18): la lista de clase del coach y el
 * check-in manual.
 *
 * Attendance no tiene colección propia: la asistencia es un estado de la
 * reserva, y duplicarla en otra colección sería tener dos verdades sobre si
 * alguien entró. Lo que este módulo aporta es **la decisión** —quién puede
 * entrar, cuándo y con qué alertas— y la vista que el coach necesita.
 */
export interface AttendanceBookings {
  find(bookingId: string): Promise<AttendanceBooking | null>;
  ofSession(sessionId: string): Promise<AttendanceBooking[]>;
  /** Las reservas del socio que esperan su check-in. Las busca el QR. */
  awaitingCheckInOf(memberId: string): Promise<AttendanceBooking[]>;
  /** Marca el ingreso. Lo escribe Booking, que es el dueño del documento. */
  markCheckedIn(
    bookingId: string,
    data: { method: CheckInMethod; by: string; at: Temporal.Instant },
  ): Promise<AttendanceBooking>;
  /**
   * Crea la reserva del walk-in **ya con el ingreso hecho**, descontando el
   * crédito en el momento (fila 7 de §2.1.9). El cupo y el crédito son de
   * Booking; acá solo se piden.
   */
  createWalkIn(data: {
    sessionId: string;
    memberId: string;
    by: string;
    idempotencyKey: string;
  }): Promise<BookingResult>;
}

/** El QR que la WAFM le muestra al socio. El token no se guarda en claro. */
export interface IssuedQrToken {
  token: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface CheckInTokens {
  issue(data: {
    memberId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Temporal.Instant;
  }): Promise<unknown>;
  byHash(tokenHash: string): Promise<StoredCheckInToken | null>;
  /** Marca el token como usado. `null` si otro escaneo llegó primero. */
  consume(tokenHash: string, at: Temporal.Instant): Promise<unknown | null>;
}

export interface StoredCheckInToken {
  memberId: string;
  userId: string;
  expiresAt: Temporal.Instant;
  usedAt: Temporal.Instant | null;
}

export interface AttendanceBooking {
  publicId: string;
  sessionId: string;
  memberId: string;
  venueId: string;
  status: string;
  waitlistPosition: number | null;
  checkedInAt: Temporal.Instant | null;
  checkInMethod: CheckInMethod | null;
}

export interface AttendanceSessions {
  find(sessionId: string): Promise<AttendanceSession | null>;
}

export interface AttendanceSession {
  publicId: string;
  name: string;
  venueId: string;
  categoryId: string;
  startAt: Temporal.Instant;
  endAt: Temporal.Instant;
  capacity: number;
  timeZone: string;
  status: string;
}

export interface AttendanceMembers {
  summariesOf(memberIds: readonly string[]): Promise<MemberSummary[]>;
  /** Deja la última asistencia en la ficha: es el predictor de baja de §7. */
  recordAttendance(memberId: string, at: Temporal.Instant): Promise<void>;
}

export interface MemberSummary {
  publicId: string;
  fullName: string;
  balanceCents: number;
  hasDebt: boolean;
}

export interface AttendanceArrears {
  assertCanTransact(memberId: string, allowDebt: boolean): Promise<void>;
}

/**
 * Los waivers son F1-20. Hasta entonces este puerto contesta que está todo
 * firmado, y la deuda queda declarada en la tarjeta: es preferible a que el
 * check-in tenga un `if` comentado esperando el módulo.
 */
export interface WaiverGate {
  missingFor(memberId: string): Promise<boolean>;
}

export const NO_WAIVERS_YET: WaiverGate = { missingFor: () => Promise.resolve(false) };

export interface VenuePolicyPort {
  policyFor(venueId: string, categoryId: string): Promise<BookingPolicy>;
}

export interface AttendanceServiceDeps {
  bookings: AttendanceBookings;
  sessions: AttendanceSessions;
  members: AttendanceMembers;
  arrears: AttendanceArrears;
  venues: VenuePolicyPort;
  tokens: CheckInTokens;
  waivers?: WaiverGate | undefined;
  events: DomainEventBus;
  now: () => Temporal.Instant;
}

export class AttendanceService {
  private readonly bookings: AttendanceBookings;
  private readonly sessions: AttendanceSessions;
  private readonly members: AttendanceMembers;
  private readonly arrears: AttendanceArrears;
  private readonly venues: VenuePolicyPort;
  private readonly tokens: CheckInTokens;
  private readonly waivers: WaiverGate;
  private readonly events: DomainEventBus;
  private readonly now: () => Temporal.Instant;

  constructor(deps: AttendanceServiceDeps) {
    this.bookings = deps.bookings;
    this.sessions = deps.sessions;
    this.members = deps.members;
    this.arrears = deps.arrears;
    this.venues = deps.venues;
    this.tokens = deps.tokens;
    this.waivers = deps.waivers ?? NO_WAIVERS_YET;
    this.events = deps.events;
    this.now = deps.now;
  }

  /**
   * 🔴 La lista de clase (§2.1.18): inscriptos, presentes, lista de espera y las
   * alertas que el coach necesita ver al lado del nombre.
   *
   * Va todo resuelto en una sola respuesta a propósito. El coach la abre con una
   * mano en el piso del box: encadenar tres pedidos para armar la pantalla es
   * pedirle que espere tres veces.
   */
  async roster(sessionId: string): Promise<ClassRoster> {
    const session = await this.sessions.find(sessionId);
    if (!session) throw sessionNotFound(sessionId);

    const policy = await this.venues.policyFor(session.venueId, session.categoryId);
    const reservas = (await this.bookings.ofSession(sessionId)).filter((booking) =>
      ['booked', 'checked_in', 'waitlisted'].includes(booking.status),
    );

    const socios = new Map(
      (await this.members.summariesOf(reservas.map((booking) => booking.memberId))).map(
        (member) => [member.publicId, member] as const,
      ),
    );

    const entries: RosterEntry[] = await Promise.all(
      reservas.map(async (booking) => {
        const socio = socios.get(booking.memberId);

        return {
          bookingId: booking.publicId,
          memberId: booking.memberId,
          // Un nombre vacío en la lista del coach es peor que uno genérico: no
          // sabría a quién está marcando.
          fullName: socio?.fullName ?? 'Socio sin ficha',
          status: booking.status as RosterEntry['status'],
          waitlistPosition: booking.waitlistPosition,
          checkedInAt: booking.checkedInAt?.toString() ?? null,
          checkInMethod: booking.checkInMethod,
          alerts: await this.alertsFor(booking.memberId, policy, socio),
        };
      }),
    );

    const ventana = checkInWindowOf(policy, session.startAt);
    const ahora = this.now();

    return {
      sessionId,
      name: session.name,
      startAt: session.startAt.toString(),
      endAt: session.endAt.toString(),
      timeZone: session.timeZone,
      capacity: session.capacity,
      bookedCount: entries.filter((entry) => entry.status !== 'waitlisted').length,
      presentCount: entries.filter((entry) => entry.status === 'checked_in').length,
      waitlistCount: entries.filter((entry) => entry.status === 'waitlisted').length,
      checkInOpen:
        Temporal.Instant.compare(ahora, ventana.opensAt) >= 0 &&
        Temporal.Instant.compare(ahora, ventana.closesAt) <= 0,
      checkInOpensAt: ventana.opensAt.toString(),
      checkInClosesAt: ventana.closesAt.toString(),
      entries: entries.sort(ordenDeLista),
    };
  }

  /**
   * 🔴 Registra el ingreso de una reserva (§2.1.18).
   *
   * Valida en este orden: que la reserva sirva, que la ventana esté abierta, que
   * el waiver esté firmado y que la deuda no lo frene. El crédito ya se
   * descontó al reservar (ADR-001), así que acá no se toca.
   */
  async checkIn(bookingId: string, method: CheckInMethod, by: string): Promise<AttendanceBooking> {
    const booking = await this.bookings.find(bookingId);
    if (!booking) throw bookingNotFound(bookingId);
    if (booking.status === 'checked_in') throw alreadyCheckedIn(bookingId, booking.checkedInAt);
    if (booking.status !== 'booked') throw notCheckable(bookingId, booking.status);

    const session = await this.sessions.find(booking.sessionId);
    if (!session) throw sessionNotFound(booking.sessionId);

    const policy = await this.venues.policyFor(session.venueId, session.categoryId);
    assertWithinCheckInWindow(policy, session.startAt, this.now(), session.timeZone);
    await this.assertCanEnter(booking.memberId, policy);

    const ahora = this.now();
    const entrada = await this.bookings.markCheckedIn(bookingId, { method, by, at: ahora });
    await this.members.recordAttendance(booking.memberId, ahora);

    await this.events.emit('attendance.checked_in', {
      bookingId,
      memberId: booking.memberId,
      method,
    });

    return entrada;
  }

  /**
   * 🔴 Emite el token del QR del socio (§2.1.18).
   *
   * Vale 30 segundos y una sola vez. Se guarda el hash: la captura de pantalla
   * que el socio le manda a su amiga no tiene que servir, y una colección con
   * los códigos en claro sería una colección de llaves de la puerta.
   */
  async issueQrToken(memberId: string, userId: string): Promise<IssuedQrToken> {
    const emitido = newCheckInToken(this.now());
    await this.tokens.issue({
      memberId,
      userId,
      tokenHash: emitido.tokenHash,
      expiresAt: emitido.expiresAt,
    });

    return {
      token: emitido.token,
      expiresAt: emitido.expiresAt.toString(),
      expiresInSeconds: QR_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * 🔴 Canjea el QR en la puerta: resuelve al socio y le marca el ingreso.
   *
   * El token identifica a la **persona**, no a la clase, así que la clase la
   * resuelve el backend: la que está dentro de su ventana de check-in. Pedirle a
   * la tablet de la puerta que sepa qué clase corre ahora sería configurar la
   * tablet cada vez que cambia el horario.
   *
   * El consumo es atómico (`usedAt: null` en el mismo `findOneAndUpdate`): dos
   * escaneos simultáneos de la misma captura no pueden entrar los dos.
   */
  async redeemQrToken(token: string, by: string, sessionId?: string): Promise<AttendanceBooking> {
    const guardado = await this.tokens.byHash(hashToken(token));
    if (!guardado) throw invalidToken();

    assertTokenUsable({ expiresAt: guardado.expiresAt, usedAt: guardado.usedAt }, this.now());

    const reserva = await this.bookingForCheckIn(guardado.memberId, sessionId);

    // Recién acá se quema el token: si no hay reserva que marcar, el socio
    // puede volver a mostrar el mismo código en vez de generar otro.
    if (!(await this.tokens.consume(hashToken(token), this.now()))) throw invalidToken();

    return this.checkIn(reserva.publicId, 'self', by);
  }

  /**
   * 🔴 El walk-in: alguien que llega sin reserva y entra en el mostrador.
   *
   * Es el **único** camino donde el crédito se descuenta en el check-in y no al
   * reservar (fila 7 de §2.1.9, ADR-001). Las validaciones son las mismas que
   * las de cualquier ingreso; lo que cambia es que la reserva se crea acá.
   */
  async walkIn(sessionId: string, memberId: string, by: string, idempotencyKey: string) {
    const session = await this.sessions.find(sessionId);
    if (!session) throw sessionNotFound(sessionId);

    const policy = await this.venues.policyFor(session.venueId, session.categoryId);
    assertWithinCheckInWindow(policy, session.startAt, this.now(), session.timeZone);
    await this.assertCanEnter(memberId, policy);

    const entrada = await this.bookings.createWalkIn({
      sessionId,
      memberId,
      by,
      idempotencyKey,
    });
    await this.members.recordAttendance(memberId, this.now());

    return entrada;
  }

  /** La reserva que este socio tiene que marcar ahora. */
  private async bookingForCheckIn(
    memberId: string,
    sessionId?: string,
  ): Promise<AttendanceBooking> {
    const candidatas = await this.bookings.awaitingCheckInOf(memberId);
    const ahora = this.now();

    for (const reserva of candidatas) {
      if (sessionId !== undefined && reserva.sessionId !== sessionId) continue;

      const session = await this.sessions.find(reserva.sessionId);
      if (!session) continue;

      const policy = await this.venues.policyFor(session.venueId, session.categoryId);
      const ventana = checkInWindowOf(policy, session.startAt);
      const abierta =
        Temporal.Instant.compare(ahora, ventana.opensAt) >= 0 &&
        Temporal.Instant.compare(ahora, ventana.closesAt) <= 0;

      if (abierta) return reserva;
    }

    throw noBookingToCheckIn(memberId);
  }

  /**
   * "Todos presentes" de un toque (§2.1.18).
   *
   * Los que no pasan la validación **no rompen la operación**: vuelven con su
   * motivo. Que el coach no pueda marcar a trece porque uno debe plata sería
   * cambiar ocho segundos de trabajo por una discusión en el piso del box.
   */
  async checkInAll(sessionId: string, by: string): Promise<BulkCheckInResult> {
    const reservas = (await this.bookings.ofSession(sessionId)).filter(
      (booking) => booking.status === 'booked',
    );

    const skipped: BulkCheckInResult['skipped'] = [];
    let checkedIn = 0;

    for (const booking of reservas) {
      try {
        await this.checkIn(booking.publicId, 'staff', by);
        checkedIn += 1;
      } catch (error) {
        skipped.push({
          bookingId: booking.publicId,
          memberId: booking.memberId,
          code: error instanceof AppError ? error.code : 'LP-SYS-500-001',
        });
      }
    }

    return { checkedIn, skipped };
  }

  /**
   * Las cuatro validaciones de §2.1.18 que dependen del socio, no de la clase.
   *
   * El waiver es **configurable por Venue** (§2.1.20): con `enforceWaivers`
   * apagado —el default— ni siquiera se consulta el módulo. Prenderlo de
   * entrada bloquearía a cualquier centro que todavía no publicó sus
   * documentos ni migró a que sus socios tengan cuenta en la WAFM.
   */
  private async assertCanEnter(memberId: string, policy: BookingPolicy): Promise<void> {
    if (policy.enforceWaivers && (await this.waivers.missingFor(memberId))) {
      throw waiverMissing(memberId);
    }

    // El crédito ya se descontó al reservar (ADR-001): lo que queda por mirar
    // acá es la deuda, y solo si el centro la usa como barrera.
    await this.arrears.assertCanTransact(memberId, policy.allowDebt);
  }

  private async alertsFor(
    memberId: string,
    policy: BookingPolicy,
    socio?: MemberSummary,
  ): Promise<RosterAlert[]> {
    const alerts: RosterAlert[] = [];
    if (socio?.hasDebt) alerts.push('debt');
    if (policy.enforceWaivers && (await this.waivers.missingFor(memberId))) {
      alerts.push('waiver_missing');
    }

    return alerts;
  }
}

/** Primero los que están adentro, después los anotados, y la fila al final. */
const ORDEN = { checked_in: 0, booked: 1, waitlisted: 2 } as const;

function ordenDeLista(a: RosterEntry, b: RosterEntry): number {
  const porEstado = ORDEN[a.status] - ORDEN[b.status];
  if (porEstado !== 0) return porEstado;
  if (a.status === 'waitlisted' && b.status === 'waitlisted') {
    return (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0);
  }

  return a.fullName.localeCompare(b.fullName, 'es-AR');
}

function bookingNotFound(bookingId: string): AppError {
  return new AppError({
    code: 'LP-ATTD-404-005',
    status: 404,
    message: 'No encontramos esa reserva.',
    meta: { bookingId },
  });
}

function sessionNotFound(sessionId: string): AppError {
  return new AppError({
    code: 'LP-BOOK-404-006',
    status: 404,
    message: 'No encontramos esa clase.',
    meta: { sessionId },
  });
}

function alreadyCheckedIn(bookingId: string, at: Temporal.Instant | null): AppError {
  return new AppError({
    code: 'LP-ATTD-409-001',
    status: 409,
    message: 'Ya registramos el ingreso a esta clase.',
    meta: { bookingId, checkedInAt: at?.toString() ?? null },
  });
}

/** Una reserva cancelada o en la fila no puede entrar: no tiene lugar. */
function notCheckable(bookingId: string, status: string): AppError {
  const enLaFila = status === 'waitlisted';

  return new AppError({
    code: 'LP-ATTD-409-006',
    status: 409,
    message: enLaFila
      ? 'Todavía está en la lista de espera: primero tiene que confirmar su lugar.'
      : 'Esa reserva ya no está activa.',
    ...(enLaFila ? { action: 'Confirmá el lugar y volvé a intentar.' } : {}),
    meta: { bookingId, status },
  });
}

/**
 * Un token que no existe da el **mismo** error que uno vencido: distinguirlos le
 * diría a quien prueba códigos ajenos cuál de los dos casi funcionó.
 */
function invalidToken(): AppError {
  return new AppError({
    code: 'LP-ATTD-422-004',
    status: 422,
    message: 'El código venció. Abrí de nuevo tu QR.',
    action: 'Mostrá el código nuevo en la puerta.',
  });
}

/** El QR era válido pero no hay clase que marcar: el socio no reservó. */
function noBookingToCheckIn(memberId: string): AppError {
  return new AppError({
    code: 'LP-ATTD-404-005',
    status: 404,
    message: 'No encontramos una reserva tuya para esta hora.',
    action: 'Pedile al mostrador que te registre como walk-in.',
    meta: { memberId },
  });
}

function waiverMissing(memberId: string): AppError {
  return new AppError({
    code: 'LP-ATTD-403-003',
    status: 403,
    message: 'Falta firmar el deslinde de responsabilidad.',
    action: 'Firmalo desde la app o en el mostrador para poder ingresar.',
    meta: { memberId },
  });
}
