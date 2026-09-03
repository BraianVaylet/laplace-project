import type { FilterQuery } from 'mongoose';
import type { NotificationChannel, NotificationEventType } from '@laplace/schemas';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { requireTenant } from '../../../tenancy/context.js';
import { publicId } from '../../../tenancy/public-id.js';
import { NotificationTemplateModel, type NotificationTemplateDoc } from './template.model.js';

export class NotificationTemplateRepository extends TenantRepository<NotificationTemplateDoc> {
  constructor() {
    super(NotificationTemplateModel, 'notificationTemplate');
  }

  async all(): Promise<NotificationTemplateDoc[]> {
    return NotificationTemplateModel.find(this.scope())
      .setOptions(sessionOption())
      .lean<NotificationTemplateDoc[]>()
      .exec();
  }

  async of(
    eventType: NotificationEventType,
    channel: NotificationChannel,
  ): Promise<NotificationTemplateDoc | null> {
    return this.findOne({ eventType, channel } as FilterQuery<NotificationTemplateDoc>);
  }

  /**
   * Guarda la plantilla del centro, pisando la anterior si ya existía.
   *
   * Es un upsert y no un `create` + `update` porque el par
   * `{ eventType, channel }` es único por tenant: dos filas para el mismo aviso
   * serían dos textos distintos y ninguna forma de saber cuál sale.
   */
  async save(data: {
    eventType: NotificationEventType;
    channel: NotificationChannel;
    subject: string;
    body: string;
    enabled: boolean;
  }): Promise<NotificationTemplateDoc> {
    const { tenantId, userId } = requireTenant();

    return NotificationTemplateModel.findOneAndUpdate(
      { tenantId, eventType: data.eventType, channel: data.channel },
      {
        $set: {
          subject: data.subject,
          body: data.body,
          enabled: data.enabled,
          updatedBy: userId,
          deletedAt: null,
        },
        $setOnInsert: {
          publicId: publicId('notificationTemplate'),
          createdBy: userId,
        },
      },
      { new: true, upsert: true, ...sessionOption() },
    )
      .lean<NotificationTemplateDoc>()
      .exec();
  }
}
