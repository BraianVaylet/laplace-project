import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { TenantRepository } from '../../../tenancy/repository.js';
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

  /** Cuantas clases futuras tiene una sala. Es lo que Rooms pregunta para poder borrarla. */
  async countFutureOfRoom(roomId: string, now: Temporal.Instant): Promise<number> {
    return this.count({
      roomId,
      status: { $ne: 'cancelled' },
      startAt: { $gt: toBsonDate(now) },
    } as FilterQuery<ClassSessionDoc>);
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
