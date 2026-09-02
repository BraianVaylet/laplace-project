import type { CreateVenueInput, UpdateVenueInput } from '@laplace/schemas';
import { DEFAULT_BOOKING_POLICY, bookingPolicySchema, type BookingPolicy } from '@laplace/schemas';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import type { Page } from '../../../tenancy/repository.js';
import { canTransition } from '../domain/venue.js';
import type { VenueRepository } from '../infrastructure/venue.repository.js';
import type { VenueDoc } from '../infrastructure/venue.model.js';

/**
 * Casos de uso de Venue. Orquesta el repositorio y emite eventos de dominio;
 * no sabe de HTTP ni de Mongoose.
 */
export class VenueService {
  constructor(
    private readonly venues: VenueRepository,
    private readonly events: DomainEventBus,
  ) {}

  async create(input: CreateVenueInput): Promise<VenueDoc> {
    /*
     * La politica se completa con los defaults de §2.1.5.c aunque el alta no la
     * mande: una sede sin ventanas de reserva no puede recibir una reserva, y
     * eso se descubriria recien al primer socio que lo intente.
     */
    const bookingPolicy = input.bookingPolicy
      ? bookingPolicySchema.parse(input.bookingPolicy)
      : DEFAULT_BOOKING_POLICY;

    const venue = await this.venues.create({
      ...input,
      bookingPolicy,
      status: 'active',
    } as Partial<VenueDoc>);

    /*
     * El Room por default lo crea el modulo Rooms escuchando este evento
     * (§1.1: el 90% tiene una sola sala y nunca deberia ver el concepto).
     * Va por evento y no por llamada directa porque un modulo no importa el
     * modelo de otro (ADR-003).
     */
    await this.events.emit('venue.created', {
      venueId: String(venue['publicId']),
      name: venue.name,
      timeZone: venue.timeZone,
    });

    return venue;
  }

  async list(cursor?: string, limit?: number): Promise<Page<VenueDoc>> {
    return this.venues.list(
      {},
      {
        sortField: 'createdAt',
        direction: 'desc',
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      },
    );
  }

  async getByPublicId(publicId: string): Promise<VenueDoc> {
    const venue = await this.venues.findByPublicId(publicId);
    if (!venue) throw notFound(publicId);

    return venue;
  }

  async update(publicId: string, input: UpdateVenueInput): Promise<VenueDoc> {
    const patch: Record<string, unknown> = { ...input };
    if (input.bookingPolicy)
      patch['bookingPolicy'] = bookingPolicySchema.parse(input.bookingPolicy);

    const updated = await this.venues.updateByPublicId(publicId, { $set: patch });
    if (!updated) throw notFound(publicId);

    return updated;
  }

  /**
   * Archivar y reactivar. **Solo por transicion explicita** (§14): no existe un
   * endpoint que escriba `status` a mano.
   */
  async changeStatus(publicId: string, to: 'active' | 'archived'): Promise<VenueDoc> {
    const venue = await this.getByPublicId(publicId);
    const from = venue.status as 'active' | 'archived';

    if (!canTransition(from, to)) {
      throw new AppError({
        code: 'LP-SCHD-422-006',
        status: 422,
        message: `No se puede pasar de ${from} a ${to}.`,
        meta: { publicId, from, to },
      });
    }

    const updated = await this.venues.updateByPublicId(publicId, { $set: { status: to } });
    if (!updated) throw notFound(publicId);

    return updated;
  }

  /**
   * La zona horaria de una sede. Es el puerto que consume Contracts: el
   * vencimiento de un pack se calcula en el calendario del centro (§2.1.2), no
   * en el del servidor.
   */
  async timeZoneOf(publicId: string): Promise<string> {
    return (await this.getByPublicId(publicId)).timeZone;
  }

  /**
   * La politica de reserva del centro, completa: las cinco ventanas de §2.1.5.c,
   * el flag de deuda de ADR-004 y las excepciones por categoria. Es el puerto
   * que consume Booking, que resuelve las ventanas por su cuenta.
   *
   * Se devuelve completa y no campo por campo porque preguntar de a uno seria
   * un viaje a la base por regla, y todas se evaluan en la misma reserva.
   */
  async policyOf(publicId: string): Promise<BookingPolicy> {
    const guardada = (await this.getByPublicId(publicId)).bookingPolicy;

    // Las sedes creadas antes de que una regla existiera no la tienen guardada:
    // el default la completa sin necesidad de migrar datos.
    return { ...DEFAULT_BOOKING_POLICY, ...((guardada ?? {}) as Partial<BookingPolicy>) };
  }

  /** Tope anual de dias de congelamiento del centro (§2.1.9). */
  async maxFreezeDaysOf(publicId: string): Promise<number> {
    const policy = (await this.getByPublicId(publicId)).bookingPolicy as {
      maxFreezeDaysPerYear?: number;
    };

    return policy.maxFreezeDaysPerYear ?? DEFAULT_BOOKING_POLICY.maxFreezeDaysPerYear;
  }

  /**
   * ¿Existe esa sede en este tenant? Es el puerto que consume Rooms (ADR-003):
   * la alternativa seria que Rooms importara el modelo de Venues.
   */
  async exists(publicId: string): Promise<boolean> {
    return (await this.venues.findByPublicId(publicId)) !== null;
  }

  /** Lo consume el guard de entitlements. Cuenta activas, no historicas. */
  countActive(): Promise<number> {
    return this.venues.countActive();
  }
}

/**
 * 404 y no 403: un 403 sobre el recurso de otro centro confirma que existe
 * (ADR-000, F0-05).
 */
function notFound(publicId: string): AppError {
  return new AppError({
    code: 'LP-SYS-404-002',
    status: 404,
    message: 'No encontramos esa sede.',
    meta: { publicId },
  });
}
