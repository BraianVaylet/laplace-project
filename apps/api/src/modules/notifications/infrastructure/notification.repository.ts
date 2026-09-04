import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import type { NotificationChannel, NotificationEventType } from '@laplace/schemas';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { requireTenant } from '../../../tenancy/context.js';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { NotificationModel, type NotificationDoc } from './notification.model.js';

/** Falla cuando ya existe `{ tenantId, dedupeKey }` (§5.2.3). */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export interface EnqueueData {
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  subject: string;
  body: string;
  dedupeKey: string;
  subjectId: string;
  sendAt: Temporal.Instant;
  destination: string | null;
}

export class NotificationRepository extends TenantRepository<NotificationDoc> {
  constructor() {
    super(NotificationModel, 'notification');
  }

  /**
   * 🔴 Encola, o no hace nada si ese aviso ya estaba encolado.
   *
   * La deduplicación es del índice, no de un `findOne` previo: entre la lectura
   * y la escritura entra la otra corrida del job y el socio recibe el mismo
   * recordatorio dos veces (§2.1.14). `null` significa "ya existía".
   */
  async enqueue(data: EnqueueData): Promise<NotificationDoc | null> {
    try {
      return await this.create({
        userId: data.userId,
        eventType: data.eventType,
        channel: data.channel,
        subject: data.subject,
        body: data.body,
        dedupeKey: data.dedupeKey,
        subjectId: data.subjectId,
        destination: data.destination,
        status: 'queued',
        attempts: 0,
        lastError: null,
        nextAttemptAt: toBsonDate(data.sendAt),
        sentAt: null,
        readAt: null,
      } as never);
    } catch (error) {
      if (isDuplicateKey(error)) return null;

      throw error;
    }
  }

  /**
   * Los avisos que ya se pueden mandar, de cualquier tenant: el job es uno solo
   * para toda la instancia y después entra al contexto de cada uno
   * (`runWithTenant`) para trabajarlos.
   */
  async dueAcrossTenants(now: Temporal.Instant, limit = 200): Promise<NotificationDoc[]> {
    return NotificationModel.find({
      deletedAt: null,
      status: 'queued',
      nextAttemptAt: { $lte: toBsonDate(now) },
    })
      .setOptions({ skipTenantScope: true })
      .sort({ nextAttemptAt: 1 })
      .limit(limit)
      .lean<NotificationDoc[]>()
      .exec();
  }

  /**
   * 🔴 Reclama el aviso para esta corrida: `queued → sending` en **una sola
   * escritura**.
   *
   * Es lo que impide el mail duplicado cuando dos corridas se pisan: la segunda
   * no encuentra el documento en `queued` y recibe `null`. Leer y después
   * escribir dejaría una ventana entre las dos operaciones, que es justo donde
   * entra la otra corrida.
   */
  async claim(publicId: string): Promise<NotificationDoc | null> {
    const { tenantId } = requireTenant();

    return NotificationModel.findOneAndUpdate(
      { tenantId, publicId, status: 'queued', deletedAt: null },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { new: true, ...sessionOption() },
    )
      .lean<NotificationDoc>()
      .exec();
  }

  async markSent(publicId: string, at: Temporal.Instant): Promise<void> {
    await this.updateByPublicId(publicId, {
      $set: { status: 'sent', sentAt: toBsonDate(at), nextAttemptAt: null, lastError: null },
    });
  }

  /** Vuelve a la cola con su próximo intento, o queda fallido si no queda ninguno. */
  async markRetry(publicId: string, nextAttemptAt: Temporal.Instant, error: string): Promise<void> {
    await this.updateByPublicId(publicId, {
      $set: { status: 'queued', nextAttemptAt: toBsonDate(nextAttemptAt), lastError: error },
    });
  }

  async markFailed(publicId: string, error: string): Promise<void> {
    await this.updateByPublicId(publicId, {
      $set: { status: 'failed', nextAttemptAt: null, lastError: error },
    });
  }

  /** La campana del usuario. Solo lo suyo: la lista nunca se filtra por parámetro. */
  async ofUser(
    userId: string,
    options: { cursor?: string | undefined; limit?: number | undefined; unreadOnly?: boolean } = {},
  ) {
    const filtro: FilterQuery<NotificationDoc> = {
      userId,
      channel: 'in_app',
      ...(options.unreadOnly ? { readAt: null } : {}),
    } as FilterQuery<NotificationDoc>;

    return this.list(filtro, {
      cursor: options.cursor,
      limit: options.limit,
      sortField: 'createdAt',
      direction: 'desc',
    });
  }

  async unreadCountOf(userId: string): Promise<number> {
    return this.count({ userId, channel: 'in_app', readAt: null } as FilterQuery<NotificationDoc>);
  }

  /**
   * Marca leído. Vuelve `false` cuando el aviso no es de quien pide: la campana
   * de uno no marca los avisos de otro.
   */
  async markRead(publicId: string, userId: string, at: Temporal.Instant): Promise<boolean> {
    const { tenantId } = requireTenant();

    const resultado = await NotificationModel.updateOne(
      { tenantId, publicId, userId, deletedAt: null, readAt: null },
      { $set: { readAt: toBsonDate(at) } },
      sessionOption(),
    ).exec();

    return resultado.matchedCount === 1;
  }

  /** El registro de entregas para soporte (§2.1.14). */
  async deliveryLog(
    filter: { userId?: string | undefined; status?: string | undefined },
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const filtro: FilterQuery<NotificationDoc> = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    } as FilterQuery<NotificationDoc>;

    return this.list(filtro, {
      cursor: options.cursor,
      limit: options.limit,
      sortField: 'createdAt',
      direction: 'desc',
    });
  }
}
