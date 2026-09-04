import type { FilterQuery } from 'mongoose';
import type { DayKpis } from '../domain/kpis.js';
import { requireTenant } from '../../../tenancy/context.js';
import { publicId } from '../../../tenancy/public-id.js';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { MetricsDailyModel, type MetricsDailyDoc } from './metrics-daily.model.js';

export class MetricsDailyRepository extends TenantRepository<MetricsDailyDoc> {
  constructor() {
    super(MetricsDailyModel, 'metricsDaily');
  }

  /**
   * 🔴 Guarda el día, pisando lo que hubiera.
   *
   * Upsert y no `create`: el job puede correr dos veces sobre el mismo día — la
   * corrida de las 03:00 más un reproceso a mano — y tiene que dar el mismo
   * resultado. El único `{ tenantId, venueId, date }` decide la carrera; acá
   * solo se pide sobreescribir.
   */
  async upsertDay(venueId: string, date: string, kpis: DayKpis): Promise<void> {
    const { tenantId, userId } = requireTenant();

    await MetricsDailyModel.updateOne(
      { tenantId, venueId, date },
      {
        $set: { ...kpis, updatedBy: userId, deletedAt: null },
        $setOnInsert: { publicId: publicId('metricsDaily'), createdBy: userId },
      },
      { upsert: true, ...sessionOption() },
    ).exec();
  }

  /** Los días del período, del más viejo al más nuevo: es el orden del gráfico. */
  async between(venueId: string, from: string, to: string): Promise<MetricsDailyDoc[]> {
    return MetricsDailyModel.find(
      this.scope({ venueId, date: { $gte: from, $lte: to } } as FilterQuery<MetricsDailyDoc>),
    )
      .sort({ date: 1 })
      .setOptions(sessionOption())
      .lean<MetricsDailyDoc[]>()
      .exec();
  }
}
