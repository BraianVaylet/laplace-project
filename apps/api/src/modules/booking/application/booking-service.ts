import { Temporal } from '@js-temporal/polyfill';
import type {
  BookingPolicy,
  BookingPolicyView,
  BookingResult,
  Consumption,
  CreateBookingInput,
} from '@laplace/schemas';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate } from '../../../persistence/bson-date.js';
import { withTransaction } from '../../../persistence/transaction.js';
import { creditEffectOf } from '../domain/credit-matrix.js';
import {
  assertWithinBookingWindow,
  bookingWindowOf,
  cancelCutoffAt,
  isLateCancel,
  policyFor,
  policyText,
} from '../domain/windows.js';
import type { BookingDoc } from '../infrastructure/booking.model.js';
import type { BookingRepository } from '../infrastructure/booking.repository.js';

/**
 * Lo que Booking necesita de los otros módulos, por interfaz (ADR-003).
 *
 * Booking es el que **orquesta**: toma el lugar, descuenta el crédito y crea la
 * reserva. Cada pieza la resuelve el módulo que la conoce.
 */
export interface SessionSeats {
  /** Toma un lugar de forma atómica. `null` si la clase ya está completa. */
  claimSeat(sessionId: string): Promise<ClaimedSession | null>;
  /** Devuelve un lugar tomado. Compensa una reserva que falló después. */
  releaseSeat(sessionId: string): Promise<void>;
  find(sessionId: string): Promise<ClaimedSession | null>;
  /** Suma o resta de la lista de espera. */
  adjustWaitlist(sessionId: string, delta: number): Promise<void>;
}

export interface ClaimedSession {
  publicId: string;
  venueId: string;
  categoryId: string;
  startAt: Temporal.Instant;
  endAt: Temporal.Instant;
  capacity: number;
  bookedCount: number;
  status: string;
  timeZone: string;
}

export interface CreditLedger {
  /** Descuenta un crédito según §2.1.9 y dice de qué contrato salió. */
  consume(
    memberId: string,
    context: { category?: string; startsAtLocal?: string },
  ): Promise<Consumption>;
  /** Devuelve un crédito a su contrato. */
  refund(contractId: string): Promise<void>;
}

export interface ArrearsGate {
  /** Corta si el socio debe y el Venue no permite deuda (§2.1.12, ADR-004). */
  assertCanTransact(memberId: string, allowDebt: boolean): Promise<void>;
}

export interface VenuePolicy {
  /**
   * La política completa del centro. Booking pide una sola cosa y resuelve las
   * ventanas él: preguntar campo por campo sería un viaje a la base por regla.
   */
  policyOf(venueId: string): Promise<BookingPolicy>;
}

export interface BookingServiceDeps {
  bookings: BookingRepository;
  sessions: SessionSeats;
  credits: CreditLedger;
  arrears: ArrearsGate;
  venues: VenuePolicy;
  events: DomainEventBus;
  /** El reloj lo inyecta la raíz de composición: acá nunca se lee la hora sola. */
  now: () => Temporal.Instant;
}

export class BookingService {
  private readonly bookings: BookingRepository;
  private readonly sessions: SessionSeats;
  private readonly credits: CreditLedger;
  private readonly arrears: ArrearsGate;
  private readonly venues: VenuePolicy;
  private readonly events: DomainEventBus;
  private readonly now: () => Temporal.Instant;

  constructor(deps: BookingServiceDeps) {
    this.bookings = deps.bookings;
    this.sessions = deps.sessions;
    this.credits = deps.credits;
    this.arrears = deps.arrears;
    this.venues = deps.venues;
    this.events = deps.events;
    this.now = deps.now;
  }

  /**
   * 🔴 Reserva. El corazón del producto y su condición de carrera clásica: dos
   * personas tomando el último lugar a las 6:00 de la mañana.
   *
   * El orden es deliberado:
   *
   * 1. **Tomar el lugar**, con un `findOneAndUpdate` que exige
   *    `bookedCount < capacity` en la misma operación. Es lo que hace imposible
   *    la sobreventa: con un `read` y después un `write`, cincuenta pedidos
   *    leerían el mismo contador y entrarían los cincuenta.
   * 2. **Descontar el crédito**, también atómico (§5.2.4).
   * 3. **Crear la reserva**, con el único `{ tenantId, sessionId, memberId }`
   *    como último cinturón.
   *
   * Si algo falla después del paso 1, se compensa hacia atrás: el lugar vuelve a
   * la clase y el crédito al contrato. Un lugar que queda tomado por una reserva
   * que nunca existió es un lugar que nadie puede usar.
   */
  async book(
    input: CreateBookingInput,
    memberId: string,
    idempotencyKey: string,
  ): Promise<BookingResult> {
    const previa = await this.bookings.byIdempotencyKey(idempotencyKey);
    if (previa) return this.toResult(previa);

    const session = await this.sessions.find(input.sessionId);
    if (!session) throw sessionNotFound(input.sessionId);
    this.assertBookable(session);

    // Las cinco ventanas de §2.1.5.c, con la excepción de la categoría encima.
    const policy = await this.policyOf(session);
    assertWithinBookingWindow(policy, session.startAt, this.now(), session.timeZone);

    if (await this.bookings.liveOf(input.sessionId, memberId)) throw alreadyBooked(input.sessionId);

    // El corte de la mora, antes de tocar nada: rechazar después de haber tomado
    // el lugar obligaría a devolverlo, y por un rato la clase figuraría llena.
    await this.arrears.assertCanTransact(memberId, policy.allowDebt);

    const lugar = await this.sessions.claimSeat(input.sessionId);
    if (!lugar) return this.joinWaitlist(session, memberId, idempotencyKey);

    let consumo: Consumption | undefined;
    try {
      consumo = await this.credits.consume(memberId, {
        category: session.categoryId,
        startsAtLocal: localTimeOf(session.startAt, session.timeZone),
      });

      const booking = await this.bookings.book({
        sessionId: input.sessionId,
        memberId,
        venueId: session.venueId,
        contractId: consumo.contractId,
        status: 'booked',
        waitlistPosition: null,
        bookedAt: this.now(),
        idempotencyKey,
      });

      await this.events.emit('booking.created', {
        bookingId: String(booking['publicId']),
        sessionId: input.sessionId,
        memberId,
        venueId: session.venueId,
      });

      return { booking: toResponse(booking), consumption: consumo };
    } catch (error) {
      // Compensación hacia atrás, en orden inverso al que se tomaron.
      if (consumo) await this.credits.refund(consumo.contractId).catch(() => undefined);
      await this.sessions.releaseSeat(input.sessionId).catch(() => undefined);

      throw error;
    }
  }

  /**
   * La clase está completa: el socio va a la fila (F1-16 la promueve).
   *
   * La lista de espera **no consume crédito**: todavía no tiene lugar, y
   * cobrárselo por esperar sería cobrarle por nada.
   */
  private async joinWaitlist(
    session: ClaimedSession,
    memberId: string,
    idempotencyKey: string,
  ): Promise<BookingResult> {
    const position = (await this.bookings.waitlistLength(session.publicId)) + 1;

    const booking = await this.bookings.book({
      sessionId: session.publicId,
      memberId,
      venueId: session.venueId,
      status: 'waitlisted',
      waitlistPosition: position,
      bookedAt: this.now(),
      idempotencyKey,
    });

    await this.sessions.adjustWaitlist(session.publicId, 1);

    return { booking: toResponse(booking) };
  }

  async get(id: string): Promise<BookingDoc> {
    const booking = await this.bookings.findByPublicId(id);
    if (!booking) throw bookingNotFound(id);

    return booking;
  }

  async ofMember(memberId: string, cursor?: string, limit?: number) {
    return this.bookings.list(
      { memberId },
      {
        sortField: 'bookedAt',
        direction: 'desc',
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      },
    );
  }

  /**
   * Cancela una reserva y devuelve su crédito y su lugar, **en una transacción**
   * (§5.2.4). A medias, el socio pierde una clase que pagó o la clase queda con
   * un lugar fantasma que nadie puede usar.
   *
   * Fuera del `cancelCutoff` la cancelación **pide confirmación** antes de
   * hacer nada: la regla de §2.1.9 ya existe igual, pero enterarse de que
   * perdiste el crédito después de cancelar es lo que la hace sentir
   * arbitraria (§2.1.5.d).
   */
  async cancel(id: string, options: { acceptsLateCancel?: boolean } = {}): Promise<BookingDoc> {
    return withTransaction(async () => {
      const booking = await this.get(id);
      if (!isLive(booking.status)) throw alreadyClosed(id, booking.status);

      if (booking.status === 'waitlisted') {
        // Nunca tuvo lugar ni crédito, así que tampoco puede cancelar tarde:
        // solo sale de la fila.
        const salida = await this.bookings.updateByPublicId(id, {
          $set: { status: 'cancelled' },
        });
        if (!salida) throw bookingNotFound(id);
        await this.sessions.adjustWaitlist(booking.sessionId, -1);

        return salida;
      }

      const session = await this.sessions.find(booking.sessionId);
      const policy = session ? await this.policyOf(session) : undefined;
      const tarde = session && policy ? isLateCancel(policy, session.startAt, this.now()) : false;

      if (tarde && options.acceptsLateCancel !== true) {
        throw lateCancelNeedsConfirmation(id, policy as BookingPolicy);
      }

      const status = tarde ? 'late_cancelled' : 'cancelled';
      const updated = await this.bookings.updateByPublicId(id, { $set: { status } });
      if (!updated) throw bookingNotFound(id);

      await this.sessions.releaseSeat(booking.sessionId);

      /*
       * La tabla de §2.1.9 decide, no este servicio: cancelar en plazo devuelve
       * y el late cancel depende de la política del centro.
       */
      const efecto = creditEffectOf(tarde ? 'late_cancelled' : 'cancelled_in_time', {
        lateCancelPolicy: policy?.lateCancelPolicy ?? 'no_refund',
      });
      if (efecto === 'refund' && booking.contractId !== undefined) {
        await this.credits.refund(booking.contractId);
      }

      await this.events.emit('booking.cancelled', {
        bookingId: id,
        sessionId: booking.sessionId,
        memberId: booking.memberId,
        creditRefunded: efecto === 'refund' && booking.contractId !== undefined,
      });

      return updated;
    });
  }

  /**
   * 🔴 Libera **todas** las reservas de una clase y devuelve sus créditos, en
   * una sola transacción (§5.2.4). Lo llama Schedule al cancelar una clase.
   *
   * Salda la deuda de F1-13: hasta ahora la cancelación pedía la liberación y
   * nadie la ejecutaba.
   */
  async releaseSession(params: { sessionId: string; reason: string }): Promise<number> {
    return withTransaction(async () => {
      const vivas = await this.bookings.liveOfSession(params.sessionId);

      for (const booking of vivas) {
        const id = String(booking['publicId']);
        await this.bookings.updateByPublicId(id, { $set: { status: 'cancelled' } });

        /*
         * La clase no se dio: el crédito se devuelve siempre, sin mirar la
         * ventana de cancelación (§2.1.9). El socio no hizo nada mal.
         */
        if (creditEffectOf('session_cancelled') === 'refund' && booking.contractId !== undefined) {
          await this.credits.refund(booking.contractId);
        }
      }

      return vivas.length;
    });
  }

  /**
   * 🔴 Libera las reservas futuras de un contrato y devuelve sus créditos, en
   * una transacción. Lo llama Contracts al congelar o vencer (§2.1.9).
   *
   * Salda la deuda de F1-09.
   */
  async releaseFuture(params: { contractId: string; memberId: string }): Promise<number> {
    const { contractId } = params;

    return withTransaction(async () => {
      const futuras = await this.futureBookingsOf(contractId);

      for (const booking of futuras) {
        await this.bookings.updateByPublicId(String(booking['publicId']), {
          $set: { status: 'cancelled' },
        });
        await this.sessions.releaseSeat(booking.sessionId);
        // Salieron del query por contrato: el crédito siempre tiene a dónde volver.
        if (creditEffectOf('contract_frozen') === 'refund') await this.credits.refund(contractId);
      }

      return futuras.length;
    });
  }

  /**
   * La política que la app le muestra al socio **antes** de confirmar
   * (§2.1.5.d): hasta cuándo puede cancelar y qué pasa si cancela tarde.
   */
  async policyViewOf(sessionId: string): Promise<BookingPolicyView> {
    const session = await this.sessions.find(sessionId);
    if (!session) throw sessionNotFound(sessionId);

    const policy = await this.policyOf(session);
    const ventana = bookingWindowOf(policy, session.startAt);
    const ahora = this.now();

    return {
      sessionId,
      opensAt: ventana.opensAt.toString(),
      closesAt: ventana.closesAt.toString(),
      cancelCutoffAt: cancelCutoffAt(policy, session.startAt).toString(),
      lateCancelPolicy: policy.lateCancelPolicy,
      text: policyText(policy, session.startAt, session.timeZone),
      canBookNow:
        Temporal.Instant.compare(ahora, ventana.opensAt) >= 0 &&
        Temporal.Instant.compare(ahora, ventana.closesAt) <= 0,
    };
  }

  /** La política del centro con la excepción de la categoría de la clase. */
  private async policyOf(session: ClaimedSession): Promise<BookingPolicy> {
    return policyFor(await this.venues.policyOf(session.venueId), session.categoryId);
  }

  /**
   * Las reservas vivas del contrato cuya clase todavía no empezó.
   *
   * Pregunta por contrato y no por socio: traerse las últimas N reservas del
   * socio y filtrar en memoria dejaría afuera, sin avisar, a quien tuviera más.
   */
  private async futureBookingsOf(contractId: string): Promise<BookingDoc[]> {
    const now = this.now();
    const candidatas = await this.bookings.liveOfContract(contractId);

    const futuras: BookingDoc[] = [];
    for (const booking of candidatas) {
      const session = await this.sessions.find(booking.sessionId);
      if (!session) continue;
      if (Temporal.Instant.compare(session.startAt, now) > 0) futuras.push(booking);
    }

    return futuras;
  }

  /** Una reserva reintentada devuelve la misma que ya existía, no una segunda (§5.0). */
  private toResult(booking: BookingDoc): BookingResult {
    return { booking: toResponse(booking) };
  }

  private assertBookable(session: ClaimedSession): void {
    if (session.status === 'cancelled') {
      throw new AppError({
        code: 'LP-BOOK-404-006',
        status: 404,
        message: 'Esa clase fue cancelada.',
        meta: { sessionId: session.publicId },
      });
    }

    if (Temporal.Instant.compare(session.startAt, this.now()) <= 0) {
      throw new AppError({
        code: 'LP-BOOK-422-003',
        status: 422,
        message: 'Esa clase ya empezó.',
        meta: { sessionId: session.publicId },
      });
    }
  }
}

/** §2.1.9: cancelar tarde pierde el crédito, y eso se avisa antes de hacerlo. */
function lateCancelNeedsConfirmation(id: string, policy: BookingPolicy): AppError {
  const devuelve = policy.lateCancelPolicy !== 'no_refund';

  return new AppError({
    code: 'LP-BOOK-422-004',
    status: 422,
    message: devuelve
      ? 'Pasó el plazo de cancelación de esta clase.'
      : 'Pasó el plazo de cancelación: si cancelás igual, se te descuenta el crédito.',
    action: 'Confirmá para cancelar de todos modos y liberar el lugar.',
    meta: { bookingId: id, lateCancelPolicy: policy.lateCancelPolicy },
  });
}

const LIVE = ['booked', 'waitlisted', 'checked_in'];
const isLive = (status: string) => LIVE.includes(status);

function toResponse(booking: BookingDoc): BookingResult['booking'] {
  return {
    publicId: String(booking['publicId']),
    sessionId: booking.sessionId,
    memberId: booking.memberId,
    venueId: booking.venueId,
    ...(booking.contractId === undefined ? {} : { contractId: booking.contractId }),
    status: booking.status as never,
    waitlistPosition: booking.waitlistPosition ?? null,
    bookedAt: fromBsonDate(booking.bookedAt).toString(),
    createdAt:
      booking['createdAt'] instanceof Date ? fromBsonDate(booking['createdAt']).toString() : '',
  };
}

/** `HH:mm` en la zona del centro. Es contra lo que se evalúa la franja del pack. */
function localTimeOf(instant: Temporal.Instant, timeZone: string): string {
  return instant.toZonedDateTimeISO(timeZone).toPlainTime().toString({ smallestUnit: 'minute' });
}

function sessionNotFound(sessionId: string): AppError {
  return new AppError({
    code: 'LP-BOOK-404-006',
    status: 404,
    message: 'No encontramos esa clase.',
    meta: { sessionId },
  });
}

function bookingNotFound(bookingId: string): AppError {
  return new AppError({
    code: 'LP-BOOK-404-006',
    status: 404,
    message: 'No encontramos esa reserva.',
    meta: { bookingId },
  });
}

function alreadyBooked(sessionId: string): AppError {
  return new AppError({
    code: 'LP-BOOK-409-001',
    status: 409,
    message: 'Ya tenés una reserva en esta clase.',
    meta: { sessionId },
  });
}

function alreadyClosed(bookingId: string, status: string): AppError {
  return new AppError({
    code: 'LP-BOOK-409-001',
    status: 409,
    message: 'Esa reserva ya estaba cerrada.',
    meta: { bookingId, status },
  });
}
