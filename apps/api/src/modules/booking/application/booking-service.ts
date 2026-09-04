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
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { withTransaction } from '../../../persistence/transaction.js';
import { runWithTenant } from '../../../tenancy/context.js';
import { creditEffectOf } from '../domain/credit-matrix.js';
import { blockUntil, isNoShowDue, noShowWindowStart } from '../domain/no-show.js';
import {
  assertWaitlistHasRoom,
  canPromote,
  holdExpiresAt,
  nextPosition,
  repositionAfter,
} from '../domain/waitlist.js';
import {
  assertWithinBookingWindow,
  bookingWindowOf,
  cancelCutoffAt,
  isLateCancel,
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

/** Lo que Booking necesita de la agenda para el job de ausentes (§2.1.5.d). */
export interface SessionHistory {
  /** Las clases que empezaron en el rango, de todos los tenants, con su centro. */
  startedBetweenAcrossTenants(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<
    Array<{
      tenantId: string;
      sessionId: string;
      venueId: string;
      categoryId: string;
      startAt: Temporal.Instant;
    }>
  >;
}

/**
 * La ficha del socio. Booking cuenta las faltas —son sus reservas— y Members
 * las guarda: ningún módulo toca el modelo del otro (ADR-003).
 */
export interface MemberPenalties {
  registerNoShow(memberId: string, blockedUntil: Temporal.Instant | null): Promise<void>;
  bookingBlockedUntil(memberId: string): Promise<Temporal.Instant | null>;
}

export interface VenuePolicy {
  /**
   * La política del centro ya resuelta para esa categoría (§2.1.5.c). Booking
   * pide una sola cosa: preguntar campo por campo sería un viaje a la base por
   * regla, y todas se evalúan en la misma reserva.
   */
  policyOf(venueId: string, categoryId?: string): Promise<BookingPolicy>;
}

export interface BookingServiceDeps {
  bookings: BookingRepository;
  sessions: SessionSeats;
  credits: CreditLedger;
  arrears: ArrearsGate;
  venues: VenuePolicy;
  events: DomainEventBus;
  history: SessionHistory;
  penalties: MemberPenalties;
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
  private readonly history: SessionHistory;
  private readonly penalties: MemberPenalties;
  private readonly now: () => Temporal.Instant;

  constructor(deps: BookingServiceDeps) {
    this.bookings = deps.bookings;
    this.sessions = deps.sessions;
    this.credits = deps.credits;
    this.arrears = deps.arrears;
    this.venues = deps.venues;
    this.events = deps.events;
    this.history = deps.history;
    this.penalties = deps.penalties;
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

    const previa2 = await this.bookings.liveOf(input.sessionId, memberId);
    if (previa2) throw alreadyBooked(input.sessionId, previa2.status);

    // Los dos cortes, antes de tocar nada: rechazar después de haber tomado el
    // lugar obligaría a devolverlo, y por un rato la clase figuraría llena.
    await this.assertNotBlocked(memberId);
    await this.arrears.assertCanTransact(memberId, policy.allowDebt);

    const lugar = await this.sessions.claimSeat(input.sessionId);
    if (!lugar) return this.joinWaitlist(session, memberId, idempotencyKey, policy);

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
    policy: BookingPolicy,
  ): Promise<BookingResult> {
    const enLaFila = await this.bookings.waitlistLength(session.publicId);
    assertWaitlistHasRoom(policy, enLaFila, session.publicId);
    const position = nextPosition(enLaFila);

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
        // solo sale de la fila. Si estaba promovido, el lugar guardado vuelve.
        const fila = await this.bookings.waitlistOf(booking.sessionId);
        const salida = await this.bookings.updateByPublicId(id, {
          $set: { status: 'cancelled', holdExpiresAt: null },
        });
        if (!salida) throw bookingNotFound(id);

        if (booking.holdExpiresAt) {
          await this.sessions.releaseSeat(booking.sessionId);
        } else {
          await this.sessions.adjustWaitlist(booking.sessionId, -1);
          await this.reposition(fila, id);
        }

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

      // El lugar que se libera es de quien está esperando desde hace rato.
      await this.promoteNext(booking.sessionId);

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
  async releaseSession(params: { sessionId: string; reason: string }): Promise<string[]> {
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

      return vivas.map((booking) => booking.memberId);
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

    const liberadas = await withTransaction(async () => {
      const futuras = await this.futureBookingsOf(contractId);

      for (const booking of futuras) {
        await this.bookings.updateByPublicId(String(booking['publicId']), {
          $set: { status: 'cancelled' },
        });
        await this.sessions.releaseSeat(booking.sessionId);
        // Salieron del query por contrato: el crédito siempre tiene a dónde volver.
        if (creditEffectOf('contract_frozen') === 'refund') await this.credits.refund(contractId);
      }

      /*
       * §2.1.5.b: quien congela su contrato sale también de las listas de
       * espera. Guardarle el lugar a alguien que decidió no venir en un mes deja
       * la fila trabada para el resto.
       */
      const esperas = await this.dropWaitlistOf(params.memberId);

      return {
        sesiones: futuras.map((booking) => booking.sessionId),
        total: futuras.length + esperas,
      };
    });

    // Los lugares que se liberaron son de quien está esperando, y promover abre
    // su propia transacción: va afuera de la que acaba de cerrar.
    for (const sessionId of liberadas.sesiones) await this.promoteNext(sessionId);

    return liberadas.total;
  }

  /**
   * 🔴 Promueve al primero de la fila y le guarda el lugar (§2.1.5.b).
   *
   * El lugar se **toma de verdad** al promover, no al confirmar: si quedara
   * libre durante la ventana, cualquiera que abriera la app se lo llevaría y el
   * aviso que acaba de recibir el primero de la fila sería mentira.
   *
   * Devuelve el id de quien fue promovido, o `null` si no había a quién.
   */
  async promoteNext(sessionId: string): Promise<string | null> {
    return withTransaction(async () => {
      const session = await this.sessions.find(sessionId);
      if (!session || session.status === 'cancelled') return null;

      const policy = await this.policyOf(session);
      const ahora = this.now();
      // Pasado el corte, avisar es mandar a alguien a llegar tarde.
      if (!canPromote(policy, session.startAt, ahora)) return null;

      const fila = await this.bookings.waitlistOf(sessionId);
      const primero = fila[0];
      if (!primero) return null;

      // El lugar se toma con el mismo `findOneAndUpdate` atómico de la reserva:
      // dos cancelaciones simultáneas no pueden promover al mismo dos veces.
      const lugar = await this.sessions.claimSeat(sessionId);
      if (!lugar) return null;

      const id = String(primero['publicId']);
      const vence = holdExpiresAt(policy, session.startAt, ahora);

      await this.bookings.updateByPublicId(id, {
        $set: {
          waitlistPosition: null,
          holdExpiresAt: toBsonDate(vence),
          promotedAt: toBsonDate(ahora),
        },
      });
      await this.sessions.adjustWaitlist(sessionId, -1);
      await this.reposition(fila, id);

      await this.events.emit('booking.waitlist_promoted', {
        bookingId: id,
        sessionId,
        memberId: primero.memberId,
        confirmBefore: vence.toString(),
      });

      return id;
    });
  }

  /**
   * El promovido confirma y la espera se vuelve reserva. Recién acá se descuenta
   * el crédito: mientras esperaba no tenía nada que consumir.
   */
  async confirmPromotion(id: string): Promise<BookingResult> {
    return withTransaction(async () => {
      const booking = await this.get(id);
      if (booking.status !== 'waitlisted' || !booking.holdExpiresAt) {
        throw alreadyClosed(id, booking.status);
      }

      const vence = fromBsonDate(booking.holdExpiresAt);
      if (Temporal.Instant.compare(this.now(), vence) > 0) throw holdExpired(id, vence);

      const session = await this.sessions.find(booking.sessionId);
      if (!session) throw sessionNotFound(booking.sessionId);

      const policy = await this.policyOf(session);
      await this.assertNotBlocked(booking.memberId);
      await this.arrears.assertCanTransact(booking.memberId, policy.allowDebt);

      const consumo = await this.credits.consume(booking.memberId, {
        category: session.categoryId,
        startsAtLocal: localTimeOf(session.startAt, session.timeZone),
      });

      const confirmada = await this.bookings.updateByPublicId(id, {
        $set: {
          status: 'booked',
          contractId: consumo.contractId,
          holdExpiresAt: null,
          confirmedAt: toBsonDate(this.now()),
        },
      });
      if (!confirmada) throw bookingNotFound(id);

      await this.events.emit('booking.created', {
        bookingId: id,
        sessionId: booking.sessionId,
        memberId: booking.memberId,
        venueId: booking.venueId,
      });

      return { booking: toResponse(confirmada), consumption: consumo };
    });
  }

  /**
   * 🔴 El job de cada minuto: al que no confirmó se le suelta el lugar y pasa al
   * siguiente (§2.1.5.b).
   *
   * Corre sobre todos los centros y abre el contexto de cada uno antes de tocar
   * nada, que es el uso legítimo de `skipTenantScope`.
   */
  async expireWaitlistHolds(): Promise<number> {
    const vencidos = await this.bookings.expiredHoldsAcrossTenants(this.now());
    let liberados = 0;

    for (const booking of vencidos) {
      const tenantId = String(booking['tenantId']);
      const id = String(booking['publicId']);

      liberados += await runWithTenant(
        { tenantId, userId: 'system:expireWaitlistHolds', requestId: `job-hold-${id}` },
        async () => {
          await withTransaction(async () => {
            await this.bookings.updateByPublicId(id, {
              $set: { status: 'cancelled', holdExpiresAt: null },
            });
            await this.sessions.releaseSeat(booking.sessionId);
          });

          await this.events.emit('booking.waitlist_hold_expired', {
            bookingId: id,
            sessionId: booking.sessionId,
            memberId: booking.memberId,
          });

          // El lugar vuelve a la fila, no a la nada: es lo que hace que la
          // promoción sea automática de punta a punta.
          await this.promoteNext(booking.sessionId);

          return 1;
        },
      );
    }

    return liberados;
  }

  /**
   * 🔴 Marca ausente a quien reservó y no hizo check-in (§2.1.5.d), y aplica la
   * penalización del centro.
   *
   * El crédito **no se devuelve**: lo dice la fila `no_show` de la tabla de
   * §2.1.9, y el lugar que ocupó no se lo pudo llevar nadie más.
   *
   * Recorre las clases y no las reservas: las que empezaron en las últimas
   * horas son un puñado, y las reservas abiertas de todo el sistema no. Es
   * idempotente porque marcar saca a la reserva de `booked`, así que la segunda
   * corrida sobre la misma hora no encuentra nada.
   */
  async markNoShows(): Promise<number> {
    const ahora = this.now();
    /*
     * Mira un día para atrás y no solo la última hora: si el runner estuvo
     * caído, las clases de la madrugada se marcan igual cuando vuelve.
     */
    const desde = ahora.subtract({ hours: 24 });
    let marcadas = 0;

    for (const clase of await this.history.startedBetweenAcrossTenants(desde, ahora)) {
      marcadas += await runWithTenant(
        {
          tenantId: clase.tenantId,
          userId: 'system:markNoShows',
          requestId: `job-noshow-${clase.sessionId}`,
        },
        () => this.markNoShowsOf(clase, ahora),
      );
    }

    return marcadas;
  }

  private async markNoShowsOf(
    clase: { sessionId: string; venueId: string; categoryId: string; startAt: Temporal.Instant },
    ahora: Temporal.Instant,
  ): Promise<number> {
    const policy = await this.venues.policyOf(clase.venueId, clase.categoryId);
    // El que llegó tarde no es un ausente: la ventana de check-in tiene que
    // haber cerrado.
    if (!isNoShowDue(policy, clase.startAt, ahora)) return 0;

    const pendientes = await this.bookings.awaitingCheckIn(clase.sessionId);

    for (const booking of pendientes) {
      const id = String(booking['publicId']);
      await this.bookings.updateByPublicId(id, { $set: { status: 'no_show' } });

      await this.events.emit('booking.no_show', {
        bookingId: id,
        sessionId: clase.sessionId,
        memberId: booking.memberId,
        venueId: clase.venueId,
      });

      await this.penalize(booking.memberId, policy, ahora);
    }

    return pendientes.length;
  }

  /**
   * Cuenta las faltas de la ventana móvil y bloquea si se pasó del umbral.
   *
   * La falta se registra **siempre**, aunque el centro tenga la política
   * desactivada: la métrica se mide igual, y es la que dice si hace falta
   * cambiar la política (§2.1.5.d).
   */
  private async penalize(
    memberId: string,
    policy: BookingPolicy,
    ahora: Temporal.Instant,
  ): Promise<void> {
    const enLaVentana = await this.bookings.noShowsSince(
      memberId,
      noShowWindowStart(policy, ahora),
    );
    const hasta = blockUntil(policy, enLaVentana, ahora);

    await this.penalties.registerNoShow(memberId, hasta);
    if (hasta) {
      await this.events.emit('booking.blocked_by_no_shows', {
        memberId,
        until: hasta.toString(),
        noShows: enLaVentana,
      });
    }
  }

  /** El socio penalizado no reserva hasta que se le vence el bloqueo. */
  private async assertNotBlocked(memberId: string): Promise<void> {
    const hasta = await this.penalties.bookingBlockedUntil(memberId);
    if (!hasta || Temporal.Instant.compare(this.now(), hasta) >= 0) return;

    throw blockedByNoShows(memberId, hasta);
  }

  /** Saca al socio de todas las filas en las que esté esperando. */
  async dropWaitlistOf(memberId: string): Promise<number> {
    const esperas = await this.bookings.waitlistedOfMember(memberId);

    for (const espera of esperas) {
      const id = String(espera['publicId']);
      const fila = await this.bookings.waitlistOf(espera.sessionId);
      await this.bookings.updateByPublicId(id, {
        $set: { status: 'cancelled', holdExpiresAt: null },
      });

      if (espera.holdExpiresAt) {
        // Tenía el lugar guardado: vuelve a la clase, no a la fila.
        await this.sessions.releaseSeat(espera.sessionId);
      } else {
        await this.sessions.adjustWaitlist(espera.sessionId, -1);
        await this.reposition(fila, id);
      }
    }

    return esperas.length;
  }

  /** Reescribe solo las posiciones que se movieron. */
  private async reposition(queue: readonly BookingDoc[], leavingId: string): Promise<void> {
    const entradas = queue.map((entry) => ({
      publicId: String(entry['publicId']),
      waitlistPosition: Number(entry.waitlistPosition ?? 0),
    }));

    for (const entry of repositionAfter(entradas, leavingId)) {
      await this.bookings.updateByPublicId(entry.publicId, {
        $set: { waitlistPosition: entry.waitlistPosition },
      });
    }
  }

  /**
   * Registra el ingreso (§2.1.18). Lo pide Attendance, que es quien valida si
   * puede entrar; acá solo se escribe, porque el documento es de este módulo.
   *
   * La transición a `checked_in` es explícita y no un `update` libre del campo
   * (regla 5): pasar de `cancelled` a `checked_in` dejaría entrar a alguien que
   * ya no tiene lugar.
   */
  async markCheckedIn(
    id: string,
    data: { method: string; by: string; at: Temporal.Instant },
  ): Promise<BookingDoc> {
    const booking = await this.get(id);
    if (booking.status !== 'booked') throw alreadyClosed(id, booking.status);

    const entrada = await this.bookings.updateByPublicId(id, {
      $set: {
        status: 'checked_in',
        checkedInAt: toBsonDate(data.at),
        checkInMethod: data.method,
        checkedInBy: data.by,
      },
    });
    if (!entrada) throw bookingNotFound(id);

    return entrada;
  }

  /**
   * 🔴 El walk-in: alguien que llega sin reserva y entra en el mostrador.
   *
   * Es el **único** camino donde el crédito se descuenta en el check-in y no al
   * reservar (ADR-001, fila 7 de §2.1.9). El orden vuelve a ser el de la
   * reserva —lugar, crédito, documento— y por el mismo motivo: si el lugar se
   * tomara al final, dos walk-ins simultáneos sobre el último cupo entrarían los
   * dos.
   *
   * Quién puede entrar lo decide Attendance (ventana, waiver, mora, bloqueo);
   * acá se ejecuta.
   */
  async walkIn(input: {
    sessionId: string;
    memberId: string;
    idempotencyKey: string;
    by: string;
  }): Promise<BookingResult> {
    const previa = await this.bookings.byIdempotencyKey(input.idempotencyKey);
    if (previa) return this.toResult(previa);

    const session = await this.sessions.find(input.sessionId);
    if (!session) throw sessionNotFound(input.sessionId);
    this.assertBookable(session);

    if (await this.bookings.liveOf(input.sessionId, input.memberId)) {
      // Ya tiene reserva: lo que corresponde es marcarle el ingreso, no crearle
      // una segunda y cobrarle dos créditos.
      throw alreadyBooked(input.sessionId);
    }

    const lugar = await this.sessions.claimSeat(input.sessionId);
    if (!lugar) throw sessionFull(input.sessionId);

    const ahora = this.now();
    let consumo: Consumption | undefined;

    try {
      consumo = await this.credits.consume(input.memberId, {
        category: session.categoryId,
        startsAtLocal: localTimeOf(session.startAt, session.timeZone),
      });

      const booking = await this.bookings.book({
        sessionId: input.sessionId,
        memberId: input.memberId,
        venueId: session.venueId,
        contractId: consumo.contractId,
        status: 'checked_in',
        waitlistPosition: null,
        bookedAt: ahora,
        idempotencyKey: input.idempotencyKey,
      });

      const id = String(booking['publicId']);
      const entrada = await this.bookings.updateByPublicId(id, {
        $set: {
          checkedInAt: toBsonDate(ahora),
          checkInMethod: 'staff',
          checkedInBy: input.by,
        },
      });

      await this.events.emit('attendance.checked_in', {
        bookingId: id,
        memberId: input.memberId,
        method: 'staff',
      });

      return { booking: toResponse(entrada ?? booking), consumption: consumo };
    } catch (error) {
      if (consumo) await this.credits.refund(consumo.contractId).catch(() => undefined);
      await this.sessions.releaseSeat(input.sessionId).catch(() => undefined);

      throw error;
    }
  }

  /** La reserva, o `null`. Lo consume Attendance, que decide su propio error. */
  async findOne(id: string): Promise<BookingDoc | null> {
    return this.bookings.findByPublicId(id);
  }

  /**
   * Las reservas del socio que todavía esperan su check-in. Es lo que necesita
   * el QR: el token identifica a la persona, no a la clase.
   */
  async awaitingCheckInOf(memberId: string): Promise<BookingDoc[]> {
    return this.bookings.awaitingCheckInOfMember(memberId);
  }

  /**
   * Cuantas reservas de cada estado tienen estas clases. Es el puerto que
   * consume Metrics (F1-23), y el unico que devuelve conteos en vez de
   * documentos: el panel no necesita saber quien reservo, necesita cuantos.
   */
  async countByStatusOf(sessionIds: readonly string[]): Promise<Record<string, number>> {
    return this.bookings.countByStatusOfSessions(sessionIds);
  }

  /**
   * Cuantos reservaron y cuantos entraron, clase por clase. Es el puerto que
   * consume el tablero del DFSM (F1-24).
   */
  async occupancyBySession(
    sessionIds: readonly string[],
  ): Promise<Record<string, { booked: number; checkedIn: number }>> {
    return this.bookings.countBySession(sessionIds);
  }

  /** Todas las reservas vivas de una clase. La consume la lista del coach. */
  async ofSession(sessionId: string): Promise<BookingDoc[]> {
    return this.bookings.liveOfSession(sessionId);
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
    return this.venues.policyOf(session.venueId, session.categoryId);
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

/**
 * §2.1.5.d: el bloqueo por faltas dice **hasta cuándo**. Un "no podés reservar"
 * sin fecha deja al socio sin saber si es por hoy o para siempre.
 */
function blockedByNoShows(memberId: string, hasta: Temporal.Instant): AppError {
  return new AppError({
    code: 'LP-BOOK-403-010',
    status: 403,
    message: `Tenés las reservas bloqueadas hasta el ${hasta.toString()} por ausencias.`,
    action: 'Hablá con el centro si creés que hay un error.',
    meta: { memberId, blockedUntil: hasta.toString() },
  });
}

/** §2.1.5.b: el lugar guardado tiene ventana, y vencida ya no vale. */
function holdExpired(bookingId: string, vencio: Temporal.Instant): AppError {
  return new AppError({
    code: 'LP-BOOK-422-009',
    status: 422,
    message: 'Se venció el plazo para confirmar tu lugar.',
    action: 'Si todavía hay lugar, podés volver a reservar.',
    meta: { bookingId, expiredAt: vencio.toString() },
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

function alreadyBooked(sessionId: string, status = 'booked'): AppError {
  // Estar en la fila y tener lugar no son lo mismo, y al socio le importa la
  // diferencia: uno ya tiene la clase, el otro está esperando.
  const enLaFila = status === 'waitlisted';

  return new AppError({
    code: enLaFila ? 'LP-BOOK-409-007' : 'LP-BOOK-409-001',
    status: 409,
    message: enLaFila
      ? 'Ya estás en la lista de espera de esta clase.'
      : 'Ya tenés una reserva en esta clase.',
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

/**
 * La clase está llena. En una reserva esto no es un error —se va a la fila—,
 * pero el walk-in es alguien que ya está parado en el mostrador: la respuesta
 * tiene que decirle que no hay lugar, no anotarlo para más tarde.
 */
function sessionFull(sessionId: string): AppError {
  return new AppError({
    code: 'LP-BOOK-409-002',
    status: 409,
    message: 'La clase está completa.',
    action: 'Ofrecele anotarse en la lista de espera de la próxima.',
    meta: { sessionId },
  });
}

/**
 * Se suscribe a la baja del socio (§2.1.5.b): quien se da de baja o queda
 * archivado sale de todas las listas de espera.
 *
 * Va por evento y no por llamada directa porque Members no puede tocar el
 * modelo de Booking (ADR-003). El bus aísla los fallos: si esto falla, la baja
 * queda hecha igual y el error se loguea — al revés sería peor.
 */
export function subscribeBookingToMembers(events: DomainEventBus, service: BookingService): void {
  events.on('member.status_changed', async ({ memberId, to }) => {
    if (to === 'active') return;

    await service.dropWaitlistOf(memberId);
  });
}
