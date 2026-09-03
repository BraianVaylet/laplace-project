import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { requireTenant } from '../../../tenancy/context.js';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { BookingModel, type BookingDoc } from './booking.model.js';

/** Las reservas activas: las que ocupan un lugar o una posicion en la fila. */
const VIVAS = ['booked', 'waitlisted', 'checked_in'];

export class BookingRepository extends TenantRepository<BookingDoc> {
  constructor() {
    super(BookingModel, 'booking');
  }

  /** La reserva viva de un socio en una clase, si la tiene. */
  async liveOf(sessionId: string, memberId: string): Promise<BookingDoc | null> {
    return this.findOne({ sessionId, memberId, status: { $in: VIVAS } } as FilterQuery<BookingDoc>);
  }

  async byIdempotencyKey(key: string): Promise<BookingDoc | null> {
    return this.findOne({ idempotencyKey: key } as FilterQuery<BookingDoc>);
  }

  /** Las reservas vivas de una clase, en el orden en que entraron. */
  async liveOfSession(sessionId: string): Promise<BookingDoc[]> {
    return BookingModel.find(
      this.scope({ sessionId, status: { $in: VIVAS } } as FilterQuery<BookingDoc>),
    )
      .sort({ bookedAt: 1 })
      .setOptions(sessionOption())
      .lean<BookingDoc[]>()
      .exec();
  }

  /**
   * Las reservas vivas de un contrato. Cuales son futuras lo decide quien llama,
   * que es el que sabe leer la agenda.
   */
  async liveOfContract(contractId: string): Promise<BookingDoc[]> {
    return BookingModel.find(
      this.scope({ contractId, status: { $in: VIVAS } } as FilterQuery<BookingDoc>),
    )
      .setOptions(sessionOption())
      .lean<BookingDoc[]>()
      .exec();
  }

  /** La fila de una clase, en orden. Los promovidos ya no estan: tienen lugar. */
  async waitlistOf(sessionId: string): Promise<BookingDoc[]> {
    return BookingModel.find(
      this.scope({
        sessionId,
        status: 'waitlisted',
        holdExpiresAt: null,
      } as FilterQuery<BookingDoc>),
    )
      .sort({ waitlistPosition: 1 })
      .setOptions(sessionOption())
      .lean<BookingDoc[]>()
      .exec();
  }

  /** Las esperas vivas de un socio. Las mata el congelamiento y la baja. */
  async waitlistedOfMember(memberId: string): Promise<BookingDoc[]> {
    return BookingModel.find(
      this.scope({ memberId, status: 'waitlisted' } as FilterQuery<BookingDoc>),
    )
      .setOptions(sessionOption())
      .lean<BookingDoc[]>()
      .exec();
  }

  /**
   * 🔴 Los lugares guardados que ya vencieron, de **todos los tenants**.
   *
   * El job no corre dentro del pedido de nadie, asi que no hay tenant en el
   * contexto: es el uso legitimo de `skipTenantScope` que documenta el plugin.
   * Devuelve el `tenantId` para que el servicio abra el contexto de cada centro
   * antes de tocar nada.
   */
  async expiredHoldsAcrossTenants(now: Temporal.Instant, limit = 500): Promise<BookingDoc[]> {
    return BookingModel.find({
      deletedAt: null,
      status: 'waitlisted',
      holdExpiresAt: { $ne: null, $lte: toBsonDate(now) },
    })
      .setOptions({ skipTenantScope: true })
      .limit(limit)
      .lean<BookingDoc[]>()
      .exec();
  }

  /** Las reservas de una clase que siguen esperando el check-in. */
  async awaitingCheckIn(sessionId: string): Promise<BookingDoc[]> {
    return BookingModel.find(this.scope({ sessionId, status: 'booked' } as FilterQuery<BookingDoc>))
      .setOptions(sessionOption())
      .lean<BookingDoc[]>()
      .exec();
  }

  /**
   * Las reservas del socio que todavia esperan su check-in.
   *
   * Es lo que necesita el QR: el token identifica a la persona, no a la clase,
   * asi que hay que encontrarle la reserva de la clase que esta por empezar.
   */
  async awaitingCheckInOfMember(memberId: string, limit = 20): Promise<BookingDoc[]> {
    return BookingModel.find(this.scope({ memberId, status: 'booked' } as FilterQuery<BookingDoc>))
      .sort({ bookedAt: -1 })
      .limit(limit)
      .setOptions(sessionOption())
      .lean<BookingDoc[]>()
      .exec();
  }

  /**
   * Las faltas del socio dentro de la ventana movil (§2.1.5.d).
   *
   * Se cuentan las reservas en `no_show` y no un contador guardado: un contador
   * hay que resetearlo, y el reseteo que no corre convierte una falta vieja en
   * un bloqueo de hoy.
   */
  async noShowsSince(memberId: string, since: Temporal.Instant): Promise<number> {
    return this.count({
      memberId,
      status: 'no_show',
      updatedAt: { $gte: toBsonDate(since) },
    } as FilterQuery<BookingDoc>);
  }

  /** Cuantos hay en la fila de una clase. Sirve para dar la posicion siguiente. */
  async waitlistLength(sessionId: string): Promise<number> {
    return this.count({
      sessionId,
      status: 'waitlisted',
      holdExpiresAt: null,
    } as FilterQuery<BookingDoc>);
  }

  /** Crea la reserva. El unico `{ tenantId, sessionId, memberId }` es el cinturon final. */
  async book(data: {
    sessionId: string;
    memberId: string;
    venueId: string;
    contractId?: string | undefined;
    status: string;
    waitlistPosition?: number | null;
    bookedAt: Temporal.Instant;
    idempotencyKey: string;
  }): Promise<BookingDoc> {
    requireTenant();

    return this.create({
      ...data,
      bookedAt: toBsonDate(data.bookedAt),
    } as never);
  }
}
