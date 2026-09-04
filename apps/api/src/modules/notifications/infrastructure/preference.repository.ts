import type { FilterQuery } from 'mongoose';
import type { NotificationChannel, NotificationEventType } from '@laplace/schemas';
import { requireTenant } from '../../../tenancy/context.js';
import { publicId } from '../../../tenancy/public-id.js';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { NotificationPreferenceModel, type NotificationPreferenceDoc } from './preference.model.js';

export class NotificationPreferenceRepository extends TenantRepository<NotificationPreferenceDoc> {
  constructor() {
    super(NotificationPreferenceModel, 'notificationPreference');
  }

  /** Las que este usuario cambió. Las que no están, quedan en "sí, mandame". */
  async ofUser(userId: string): Promise<NotificationPreferenceDoc[]> {
    return NotificationPreferenceModel.find(
      this.scope({ userId } as FilterQuery<NotificationPreferenceDoc>),
    )
      .setOptions(sessionOption())
      .lean<NotificationPreferenceDoc[]>()
      .exec();
  }

  /**
   * Guarda una preferencia, pisando la anterior.
   *
   * Upsert por el mismo motivo que las plantillas: el único
   * `{ tenantId, userId, eventType, channel }` no admite dos filas, y sin
   * upsert un segundo guardado del mismo interruptor tiraría E11000 en la cara
   * del usuario.
   */
  async set(data: {
    userId: string;
    eventType: NotificationEventType;
    channel: NotificationChannel;
    enabled: boolean;
  }): Promise<void> {
    const { tenantId, userId } = requireTenant();

    await NotificationPreferenceModel.updateOne(
      {
        tenantId,
        userId: data.userId,
        eventType: data.eventType,
        channel: data.channel,
      },
      {
        $set: { enabled: data.enabled, updatedBy: userId },
        $setOnInsert: {
          publicId: publicId('notificationPreference'),
          createdBy: userId,
          deletedAt: null,
        },
      },
      { upsert: true, ...sessionOption() },
    ).exec();
  }
}
