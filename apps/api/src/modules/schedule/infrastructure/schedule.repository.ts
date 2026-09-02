import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { requireTenant } from '../../../tenancy/context.js';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { VenueClosureModel, type VenueClosureDoc } from './closure.model.js';
import {
  ClassSessionModel,
  ClassTemplateModel,
  type ClassSessionDoc,
  type ClassTemplateDoc,
} from './schedule.model.js';

/** Plantillas recurrentes del centro. */
export class ClassTemplateRepository extends TenantRepository<ClassTemplateDoc> {
  constructor() {
    super(ClassTemplateModel, 'classTemplate');
  }

  /**
   * 🔴 Plantillas activas de **todos los tenants**, para el job que materializa.
   *
   * Un job no corre dentro del pedido de nadie: es el mismo uso legitimo de
   * `skipTenantScope` que documenta el plugin. Devuelve el `tenantId` para que
   * el servicio abra el contexto de cada centro antes de escribir.
   */
  async activeAcrossTenants(limit = 2000): Promise<ClassTemplateDoc[]> {
    return ClassTemplateModel.find({ deletedAt: null, active: true })
      .setOptions({ skipTenantScope: true })
      .limit(limit)
      .lean<ClassTemplateDoc[]>()
      .exec();
  }
}

/** Clases concretas, materializadas o cargadas a mano. */
export class ClassSessionRepository extends TenantRepository<ClassSessionDoc> {
  constructor() {
    super(ClassSessionModel, 'classSession');
  }

  /** La agenda de una sede en una ventana de tiempo, en orden cronologico. */
  async between(
    venueId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
    extra: FilterQuery<ClassSessionDoc> = {},
  ): Promise<ClassSessionDoc[]> {
    return ClassSessionModel.find(
      this.scope({
        venueId,
        startAt: { $gte: toBsonDate(from), $lt: toBsonDate(to) },
        ...extra,
      } as FilterQuery<ClassSessionDoc>),
    )
      .sort({ startAt: 1 })
      .lean<ClassSessionDoc[]>()
      .exec();
  }

  /** Las clases de una sala que se pisan con una ventana. Es el chequeo de colision. */
  async collidingIn(
    roomId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<ClassSessionDoc[]> {
    return ClassSessionModel.find(
      this.scope({
        roomId,
        // Se pisan si empieza antes de que la otra termine y termina despues de
        // que la otra empieza. Los bordes que se tocan no se pisan.
        status: { $ne: 'cancelled' },
        startAt: { $lt: toBsonDate(to) },
        endAt: { $gt: toBsonDate(from) },
      } as FilterQuery<ClassSessionDoc>),
    )
      .lean<ClassSessionDoc[]>()
      .exec();
  }

  /**
   * 🔴 Toma un lugar de la clase de forma **atomica** (§2.1.5.e).
   *
   * El filtro exige `bookedCount < capacity` y el `$inc` sucede en la misma
   * operacion. Con un `read` y despues un `write`, cincuenta pedidos a las 6:00
   * leerian el mismo contador y entrarian los cincuenta: eso es sobreventa, y a
   * las 6:05 hay diez personas paradas afuera.
   */
  async claimSeat(publicId: string): Promise<ClassSessionDoc | null> {
    const { tenantId } = requireTenant();

    return ClassSessionModel.findOneAndUpdate(
      {
        publicId,
        tenantId,
        deletedAt: null,
        status: { $nin: ['cancelled', 'completed'] },
        $expr: { $lt: ['$bookedCount', '$capacity'] },
      },
      { $inc: { bookedCount: 1 } },
      { new: true, ...sessionOption() },
    )
      .lean<ClassSessionDoc>()
      .exec();
  }

  /** Devuelve un lugar tomado. Compensa una reserva que fallo despues del claim. */
  async releaseSeat(publicId: string): Promise<void> {
    const { tenantId } = requireTenant();

    await ClassSessionModel.updateOne(
      // El `$gt: 0` evita que una doble devolucion deje el contador negativo.
      { publicId, tenantId, deletedAt: null, bookedCount: { $gt: 0 } },
      { $inc: { bookedCount: -1 } },
      sessionOption(),
    ).exec();
  }

  /** Suma o resta de la lista de espera. */
  async adjustWaitlist(publicId: string, delta: number): Promise<void> {
    const { tenantId } = requireTenant();

    await ClassSessionModel.updateOne(
      {
        publicId,
        tenantId,
        deletedAt: null,
        ...(delta < 0 ? { waitlistCount: { $gt: 0 } } : {}),
      },
      { $inc: { waitlistCount: delta } },
      sessionOption(),
    ).exec();
  }

  /** Cuantas clases futuras tiene una sala. Es lo que Rooms pregunta para poder borrarla. */
  async countFutureOfRoom(roomId: string, now: Temporal.Instant): Promise<number> {
    return this.count({
      roomId,
      status: { $ne: 'cancelled' },
      startAt: { $gt: toBsonDate(now) },
    } as FilterQuery<ClassSessionDoc>);
  }

  /**
   * Las clases futuras de una plantilla. Es lo que toca "esta y futuras": las
   * pasadas **nunca** se editan, son el historico de lo que de verdad ocurrio.
   */
  async futureOfTemplate(templateId: string, now: Temporal.Instant): Promise<ClassSessionDoc[]> {
    return ClassSessionModel.find(
      this.scope({
        templateId,
        startAt: { $gt: toBsonDate(now) },
        status: { $nin: ['cancelled', 'completed'] },
      } as FilterQuery<ClassSessionDoc>),
    )
      .lean<ClassSessionDoc[]>()
      .exec();
  }

  /** Los inicios ya materializados de una plantilla, para no duplicarlos. */
  async startsOfTemplate(
    templateId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<Set<number>> {
    const existentes = await ClassSessionModel.find(
      this.scope({
        templateId,
        startAt: { $gte: toBsonDate(from), $lt: toBsonDate(to) },
      } as FilterQuery<ClassSessionDoc>),
    )
      .select({ startAt: 1 })
      .lean<Array<{ startAt: Date }>>()
      .exec();

    return new Set(existentes.map((session) => session.startAt.getTime()));
  }
}

/** Feriados y cierres del centro. */
export class VenueClosureRepository extends TenantRepository<VenueClosureDoc> {
  constructor() {
    super(VenueClosureModel, 'venueClosure');
  }

  /** Los cierres de una sede que tocan un rango de dias, en `YYYY-MM-DD`. */
  async coveringRange(venueId: string, from: string, to: string): Promise<VenueClosureDoc[]> {
    return VenueClosureModel.find(
      this.scope({
        venueId,
        // Se solapan si empieza antes de que termine el rango y termina despues
        // de que empieza. Las fechas son strings ISO, asi que comparan bien.
        from: { $lte: to },
        to: { $gte: from },
      } as FilterQuery<VenueClosureDoc>),
    )
      .lean<VenueClosureDoc[]>()
      .exec();
  }

  async ofVenue(venueId: string): Promise<VenueClosureDoc[]> {
    return VenueClosureModel.find(this.scope({ venueId } as FilterQuery<VenueClosureDoc>))
      .sort({ from: 1 })
      .lean<VenueClosureDoc[]>()
      .exec();
  }
}
